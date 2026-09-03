
"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { coverFit } from "@/lib/coverFit";
import { mediaUrl } from "@/lib/media";
import "./ScrollSequence.css";

interface ScrollSequenceProps {
  /** Total number of frames extracted from the video. */
  frameCount: number;
  /** How many screen-heights of scrolling the sequence spans. Higher = slower, more deliberate. */
  scrollHeightVh?: number;
  /**
   * Ambience loop, tried in order — first source that decodes wins. See
   * AMBIENCE_SOURCES for why there is more than one.
   */
  audioSrc?: readonly string[];
  /** Fires once the sequence reaches its final frame. */
  onComplete?: () => void;
  /** Rendered on top of the final frame — the interactive hub (door hotspots). */
  children?: React.ReactNode;
}

/**
 * Two frame sets exist: 1920px for desktop (~33MB) and 960px for mobile (~11MB).
 * Picking by viewport width keeps phones off the heavy set.
 */
const frameSetUrl = (quality: "desktop" | "mobile", index: number) =>
  mediaUrl(`/frames/${quality}/${String(index).padStart(4, "0")}.webp`);

/**
 * The opening and closing frames are the only two anyone ever looks at while
 * stationary — the landing shot, and the foyer they pick a door from. Every
 * frame between them exists purely in motion, where fine detail is invisible.
 * So those two are served at the source's full 4K and preloaded up front, which
 * means they're already in place before you arrive rather than sharpening
 * under you.
 */
const HERO_FRAMES = {
  first: mediaUrl("/frames/hero-first.webp"),
  last: mediaUrl("/frames/hero-last.webp"),
} as const;

/**
 * A handful of missing frames is invisible mid-scrub — the previous frame just
 * holds for an extra beat. A wholesale failure (bad CDN prefix, dead origin) is
 * a black screen, and has to surface as one. This is the line between the two.
 */
const FAILURE_THRESHOLD = 0.25;

/**
 * The cue stays up for the entire walk and only clears once the foyer is
 * actually reached — matching `atEnd`, so it goes as the doors arrive rather
 * than leaving a stretch where neither is on screen.
 */
const CUE_RETIRES_AT = 0.995;

/**
 * The loop was a 380KB WAV because AAC and MP3 pad every file with encoder
 * delay, so the loop point always clicks — see the note on the audio setup
 * below. Compressing it therefore can't mean "encode to AAC"; it has to mean a
 * format that survives being looped.
 *
 * Opus carries its pre-skip in the header and decoders trim it, so it loops
 * clean at 19KB — a 20x saving. Safari has been unreliable about decoding Opus
 * in Web Audio, so FLAC sits behind it: lossless, bit-identical to the WAV, and
 * still a third of the size. Whichever decodes first is the one that plays, and
 * only that one is ever downloaded.
 */
const AMBIENCE_SOURCES = [
  mediaUrl("/audio/rain-loop.webm"),
  mediaUrl("/audio/rain-loop.flac"),
] as const;

export default function ScrollSequence({
  frameCount,
  scrollHeightVh = 500,
  audioSrc = AMBIENCE_SOURCES,
  onComplete,
  children,
}: ScrollSequenceProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const framesRef = useRef<HTMLImageElement[]>([]);
  const heroRef = useRef<{
    first?: HTMLImageElement;
    last?: HTMLImageElement;
  }>({});
  const currentFrameRef = useRef(-1);
  const smoothFrameRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const progressRef = useRef(0);
  const audioStartedRef = useRef(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);

  const atEndRef = useRef(false);
  const cueRef = useRef(true);
  const readyRef = useRef(false);

  const [loadedCount, setLoadedCount] = useState(0);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [atEnd, setAtEnd] = useState(false);
  const [cueVisible, setCueVisible] = useState(true);

  // Paint a frame, scaled to cover the canvas without distortion.
  const drawFrame = useCallback((index: number) => {
    const canvas = canvasRef.current;

    // At either end of the sequence, prefer the 4K version if it has arrived.
    const total = framesRef.current.length;
    const hero =
      index === 0
        ? heroRef.current.first
        : index === total - 1
          ? heroRef.current.last
          : undefined;

    // A frame that 404'd still reports `complete`; only `naturalWidth` tells
    // the two apart. Skipping it leaves the previous frame up, which reads as
    // a held beat rather than a flicker to black.
    const usable = (
      candidate?: HTMLImageElement
    ): candidate is HTMLImageElement =>
      Boolean(candidate?.complete && candidate.naturalWidth > 0);

    const img = usable(hero) ? hero : framesRef.current[index];
    if (!canvas || !usable(img)) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;

    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    // Shared with the door hotspots — see lib/coverFit for why this can't be
    // left to CSS.
    const { drawWidth, drawHeight, offsetX, offsetY } = coverFit(
      width,
      height,
      img.naturalWidth,
      img.naturalHeight
    );

    ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);
  }, []);

  // Preload every frame up front — scrubbing must never wait on a network request.
  // One set only, chosen by viewport: phones get the 960px frames, everything
  // else gets 1920px. Loading small first and upgrading behind the scenes was
  // tried and dropped — it left wide screens sitting on mobile-grade frames.
  useEffect(() => {
    let cancelled = false;
    let loaded = 0;
    let errored = 0;

    const quality: "desktop" | "mobile" = window.matchMedia(
      "(max-width: 767px)"
    ).matches
      ? "mobile"
      : "desktop";

    const images: HTMLImageElement[] = new Array(frameCount);

    for (let i = 0; i < frameCount; i++) {
      const img = new Image();
      img.src = frameSetUrl(quality, i + 1);

      const settle = (ok: boolean) => {
        if (cancelled) return;
        if (ok) loaded++;
        else errored++;

        setLoadedCount(loaded);
        if (loaded + errored < frameCount) return;

        // Everything has resolved one way or the other. Enough frames missing
        // means there's nothing to show, so say so instead of revealing a
        // black canvas and calling it ready — unless the foyer shortcut has
        // already put a usable frame on screen, in which case an error panel
        // would be replacing something that works.
        if (errored / frameCount > FAILURE_THRESHOLD) {
          if (!readyRef.current) setFailed(true);
        } else {
          readyRef.current = true;
          setReady(true);
        }
      };

      img.onload = () => settle(true);
      img.onerror = () => settle(false);
      images[i] = img;
    }

    framesRef.current = images;

    // Full-resolution stand-ins for the two resting frames. Loaded alongside
    // the sequence so they're ready before the user reaches either one.
    if (quality === "desktop") {
      (["first", "last"] as const).forEach((which) => {
        const hero = new Image();
        hero.src = HERO_FRAMES[which];
        hero.onload = () => {
          if (cancelled) return;
          heroRef.current[which] = hero;
          // Repaint if we're already sitting on the frame it replaces.
          const index = which === "first" ? 0 : frameCount - 1;
          if (currentFrameRef.current === index) drawFrame(index);
        };
      });
    }

    return () => {
      cancelled = true;
    };
  }, [frameCount, drawFrame]);

  /**
   * Arriving back at the foyer rather than walking in.
   *
   * Leaving a room shouldn't put you outside the house again. Two ways in:
   * `?foyer` for the explicit control on the room pages, and a restored scroll
   * position near the end, which is what the browser's Back button produces.
   *
   * Either way the sequence skips its own loading gate — the only frame needed
   * to stand in the foyer is the last one. The other 192 keep downloading
   * behind it, so scrolling back out still works once they arrive.
   */
  useEffect(() => {
    const container = containerRef.current;
    if (!container || ready) return;

    const scrollable = container.offsetHeight - window.innerHeight;
    const restored =
      scrollable > 0
        ? Math.min(
            Math.max(-container.getBoundingClientRect().top / scrollable, 0),
            1
          )
        : 0;

    const flagged = new URLSearchParams(window.location.search).has("foyer");
    if (!flagged && restored < 0.9) return;

    let cancelled = false;
    let settling: number | null = null;

    /**
     * Held for a few frames rather than set once. A client-side navigation
     * scrolls the new route to the top as part of its own commit, which lands
     * *after* an effect — a single scrollTo here gets quietly undone and the
     * walk starts from the street again. Re-asserting for a handful of frames
     * outlasts that, and costs nothing once the position stops moving.
     */
    const target = container.offsetTop + scrollable;

    if (flagged) {
      let attempts = 0;

      const hold = () => {
        if (cancelled) return;

        if (Math.abs(window.scrollY - target) > 2) {
          window.scrollTo({ top: target, behavior: "auto" });
        }

        // ~8 frames. Long enough to cover the router's scroll, short enough
        // that it can't fight a user who starts scrolling immediately.
        if (++attempts < 8) settling = requestAnimationFrame(hold);
      };

      hold();
    }

    const quality: "desktop" | "mobile" = window.matchMedia(
      "(max-width: 767px)"
    ).matches
      ? "mobile"
      : "desktop";

    const last = new Image();
    last.src =
      quality === "desktop"
        ? HERO_FRAMES.last
        : frameSetUrl(quality, frameCount);

    last.onload = () => {
      if (cancelled) return;

      heroRef.current.last = last;
      smoothFrameRef.current = frameCount - 1;
      currentFrameRef.current = frameCount - 1;

      drawFrame(frameCount - 1);
      readyRef.current = true;
      setReady(true);
    };

    return () => {
      cancelled = true;
      if (settling !== null) cancelAnimationFrame(settling);
    };
  }, [frameCount, drawFrame, ready]);

  // Map scroll position onto a frame index, easing toward it rather than
  // snapping. A mouse wheel scrolls in ~100px jumps; without damping those
  // jumps land as visible 4-5 frame leaps.
  useEffect(() => {
    if (!ready) return;

    const readTarget = () => {
      const container = containerRef.current;
      if (!container) return 0;

      const rect = container.getBoundingClientRect();
      const scrollable = container.offsetHeight - window.innerHeight;
      const progress =
        scrollable <= 0 ? 0 : Math.min(Math.max(-rect.top / scrollable, 0), 1);

      // Guarded against the refs rather than fired every tick: this runs inside
      // the rAF loop, and handing React a setState 60 times a second to discard
      // costs real frames.
      const ended = progress >= 0.995;
      if (ended !== atEndRef.current) {
        atEndRef.current = ended;
        setAtEnd(ended);
      }

      // Up for the whole walk, gone on arrival, and back again if you scroll
      // away from the foyer.
      const cue = progress < CUE_RETIRES_AT;
      if (cue !== cueRef.current) {
        cueRef.current = cue;
        setCueVisible(cue);
      }

      progressRef.current = progress;
      return progress * (frameCount - 1);
    };

    // Ambience runs on its own clock — tying it to scroll meant seeking, and
    // audio seeks are audible. It also can't use <audio loop>: AAC and MP3 pad
    // every file with silence, so the loop point always clicks. Decoding into
    // an AudioBuffer and looping that is sample-accurate and truly gapless.
    const startAudio = () => {
      if (audioStartedRef.current) return;
      audioStartedRef.current = true;

      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const ctx = new Ctx();
      audioCtxRef.current = ctx;

      // Walk the candidate formats until one both fetches and decodes. A
      // browser that can't handle Opus fails at decodeAudioData, not at fetch,
      // so the fallback has to sit behind the decode rather than the request.
      const decodeFirstPlayable = async (
        sources: readonly string[]
      ): Promise<AudioBuffer> => {
        let lastError: unknown;

        for (const src of sources) {
          try {
            const res = await fetch(src);
            if (!res.ok) throw new Error(`${res.status} for ${src}`);
            return await ctx.decodeAudioData(await res.arrayBuffer());
          } catch (err) {
            lastError = err;
          }
        }

        throw lastError ?? new Error("No playable ambience source");
      };

      decodeFirstPlayable(audioSrc)
        .then((buffer) => {
          const source = ctx.createBufferSource();
          source.buffer = buffer;
          source.loop = true;

          const gain = ctx.createGain();
          gain.gain.setValueAtTime(0, ctx.currentTime);
          gain.gain.linearRampToValueAtTime(0.7, ctx.currentTime + 1.2);

          source.connect(gain).connect(ctx.destination);
          source.start();
          audioSourceRef.current = source;

          // Autoplay policy may have created the context suspended.
          if (ctx.state === "suspended") ctx.resume().catch(() => {});
        })
        .catch(() => {
          audioStartedRef.current = false;
        });
    };

    const tick = () => {
      const target = readTarget();
      const current = smoothFrameRef.current;
      const delta = target - current;

      // Close enough — settle exactly and let the loop idle.
      if (Math.abs(delta) < 0.02) {
        smoothFrameRef.current = target;
        const frame = Math.round(target);
        if (frame !== currentFrameRef.current) {
          currentFrameRef.current = frame;
          drawFrame(frame);
        }
        rafRef.current = null;
        return;
      }

      smoothFrameRef.current = current + delta * 0.15;

      const frame = Math.round(smoothFrameRef.current);
      if (frame !== currentFrameRef.current) {
        currentFrameRef.current = frame;
        drawFrame(frame);
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    const kick = () => {
      startAudio();
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };

    const onResize = () => {
      currentFrameRef.current = -1;
      kick();
    };

    smoothFrameRef.current = readTarget();
    currentFrameRef.current = -1;
    kick();

    window.addEventListener("scroll", kick, { passive: true });
    window.addEventListener("resize", onResize);

    // Browsers refuse audio until the page has been interacted with. Scroll
    // alone doesn't always count as activation, so a click unlocks it too.
    const unlockAudio = () => {
      startAudio();
    };
    window.addEventListener("pointerdown", unlockAudio);

    return () => {
      window.removeEventListener("scroll", kick);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointerdown", unlockAudio);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      audioSourceRef.current?.stop();
      audioCtxRef.current?.close().catch(() => {});
    };
  }, [ready, frameCount, drawFrame, audioSrc]);

  useEffect(() => {
    if (atEnd) onComplete?.();
  }, [atEnd, onComplete]);

  const progressPct = frameCount
    ? Math.round((loadedCount / frameCount) * 100)
    : 0;

  return (
    <div
      ref={containerRef}
      className="scroll-sequence"
      style={{ height: `${scrollHeightVh}vh` }}
    >
      <div className="scroll-sequence-stage">
        <canvas ref={canvasRef} className="scroll-sequence-canvas" />

        {!ready && !failed && (
          <div className="scroll-sequence-loader">
            <span className="scroll-sequence-loader-text">
              Entering the Continental
            </span>
            <span className="scroll-sequence-loader-pct">{progressPct}%</span>
          </div>
        )}

        {/* Only once the frames are up — offering it over the loader would be
            telling people to scroll something that isn't there yet. */}
        {ready && (
          <div
            className={`scroll-sequence-cue${cueVisible ? "" : " is-gone"}`}
            aria-hidden="true"
          >
            {/* Entry animation lives on the inner element so the outer one is
                free to own show/hide — an animation's fill would otherwise pin
                opacity and defeat the transition. */}
            <div className="scroll-sequence-cue-inner">
              <span className="scroll-sequence-cue-text">Keep scrolling</span>
              <span className="scroll-sequence-cue-line" />
            </div>
          </div>
        )}

        {failed && (
          <div className="scroll-sequence-loader" role="alert">
            <span className="scroll-sequence-loader-text">
              The Continental is unreachable
            </span>
            <span className="scroll-sequence-loader-pct">
              Check your connection and reload
            </span>
          </div>
        )}

        {ready && (
          <div
            className={`scroll-sequence-overlay${
              atEnd ? " is-active" : ""
            }`}
          >
            {children}
          </div>
        )}
      </div>
    </div>
  );
}
