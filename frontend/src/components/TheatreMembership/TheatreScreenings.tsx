"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import MuxPlayer from "@mux/mux-player-react";
import { suspendBackgroundMusic } from "@/components/FoyerAudio/musicFocus";
import "./TheatreMembership.css";

type Video = { id: string; title: string; description: string; isSample: boolean };
type Playback = { playbackId: string; tokens: { playback: string; drm: string; thumbnail: string; storyboard: string } };
const EMPTY_THUMBNAILS: Record<string, string> = {};

function VideoPoster({ src }: { src?: string }) {
  const [failed, setFailed] = useState<string>();
  return <span className="theatre-card-poster">
    <span className="theatre-card-placeholder" aria-hidden="true">CONTINENTAL<br /><span>PRIVATE SCREENING</span></span>
    {/* Signed Mux URLs must bypass shared image-optimizer caches. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    {src && failed !== src && <img src={src} alt="" width={640} height={360} referrerPolicy="strict-origin-when-cross-origin" onError={() => setFailed(src)} />}
    <span className="theatre-card-play" aria-hidden="true">▶</span>
  </span>;
}

/** Only mounted by the server-authorized Theatre page. APIs independently re-check access. */
export default function TheatreScreenings({ videos, initialThumbnails = EMPTY_THUMBNAILS, initialPaidThrough, initialCheckedAt = 0 }: {
  videos: Video[]; initialThumbnails?: Record<string, string>; initialPaidThrough?: string; initialCheckedAt?: number;
}) {
  const [playback, setPlayback] = useState<Playback | null>(null);
  const [videoId, setVideoId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [thumbnails, setThumbnails] = useState<Record<string, string>>(initialThumbnails);
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const activePlayback = useRef<AbortController | null>(null);
  const requestId = useRef(0);
  const invalidatePlayback = useCallback(() => { requestId.current++; activePlayback.current?.abort(); }, []);
  const closePlayer = useCallback(() => {
    invalidatePlayback();
    setPlayback(null); setVideoId(null); setBusy(false); setMessage("");
    dialog.current?.close();
  }, [invalidatePlayback]);
  const leave = useCallback(() => {
    closePlayer();
    setThumbnails({});
    window.location.replace("/account/theatre");
  }, [closePlayer]);

  useEffect(() => {
    let controller: AbortController | undefined;
    let lastFetch = Object.keys(initialThumbnails).length ? initialCheckedAt : 0;
    async function refresh() {
      if (document.visibilityState === "hidden") return;
      controller?.abort();
      const request = new AbortController(); controller = request;
      lastFetch = Date.now();
      try {
        const response = await fetch("/api/theatre/thumbnails", { cache: "no-store", signal: request.signal });
        if (request.signal.aborted) return;
        if ([401, 403].includes(response.status)) { leave(); return; }
        if (!response.ok) return; // Keep the library usable when previews are unavailable.
        const body = await response.json();
        if (!request.signal.aborted) setThumbnails(body.thumbnails ?? {});
      } catch { /* The branded placeholder remains visible; never fall back to public URLs. */ }
    }
    const onVisible = () => { if (Date.now() - lastFetch > 120000) void refresh(); };
    if (Date.now() - lastFetch > 120000) void refresh();
    const timer = setInterval(() => { void refresh(); }, 180000);
    document.addEventListener("visibilitychange", onVisible);
    return () => { controller?.abort(); clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [leave, initialThumbnails, initialCheckedAt]);

  useEffect(() => {
    let active: AbortController | undefined;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    let lastCheck = initialPaidThrough ? initialCheckedAt : 0;
    function scheduleExpiry(paidThrough: string) {
      const remaining = Date.parse(paidThrough) - Date.now();
      if (!Number.isFinite(remaining) || remaining <= 0) { leave(); return false; }
      clearTimeout(expiry);
      expiry = setTimeout(leave, Math.min(remaining, 2147483647));
      return true;
    }
    async function check() {
      if (Date.now() - lastCheck < 60000) return;
      lastCheck = Date.now();
      active?.abort();
      const controller = new AbortController();
      active = controller;
      try {
        const response = await fetch("/api/theatre/membership?view=access", { cache: "no-store", signal: controller.signal });
        const body = await response.json();
        if (controller.signal.aborted) return;
        if (!response.ok || !body.active) { leave(); return; }
        scheduleExpiry(body.paidThrough);
      } catch { if (!controller.signal.aborted) leave(); }
    }
    const onFocus = () => { void check(); };
    const onVisible = () => { if (document.visibilityState === "visible") void check(); };
    const onPageShow = (event: PageTransitionEvent) => { if (event.persisted) window.location.reload(); };
    if (!initialPaidThrough || scheduleExpiry(initialPaidThrough)) void check();
    const timer = setInterval(onFocus, 60000);
    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active?.abort(); invalidatePlayback();
      clearInterval(timer); clearTimeout(expiry);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [leave, invalidatePlayback, initialPaidThrough, initialCheckedAt]);

  const play = useCallback(async (id: string, renewal = false) => {
    activePlayback.current?.abort();
    const controller = new AbortController(); activePlayback.current = controller;
    const current = ++requestId.current;
    if (!renewal) { setVideoId(id); setPlayback(null); }
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/theatre/playback/${encodeURIComponent(id)}`, { method: "POST", cache: "no-store", signal: controller.signal });
      if (current !== requestId.current) return;
      if ([401, 403].includes(response.status)) { leave(); return; }
      const body = await response.json();
      if (current !== requestId.current) return;
      if (!response.ok) throw new Error(body.error || "Protected playback is unavailable.");
      setPlayback(body);
    } catch {
      if (current === requestId.current) { setPlayback(null); setMessage("Protected playback is unavailable. Please retry shortly."); }
    } finally { if (current === requestId.current) setBusy(false); }
  }, [leave]);
  const playing = Boolean(playback);
  useEffect(() => {
    if (!videoId || !playing) return;
    const timer = setInterval(() => { void play(videoId, true); }, 180000);
    return () => clearInterval(timer);
  }, [videoId, playing, play]);

  useEffect(() => {
    if (!videoId || !dialog.current) return;
    const element = dialog.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    element.showModal();
    const resumeMusic = suspendBackgroundMusic();
    closeButton.current?.focus();
    document.body.style.overflow = "hidden";
    return () => {
      element.close();
      resumeMusic();
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [videoId]);

  const selectedVideo = videos.find(video => video.id === videoId);

  return <section className="theatre-membership" aria-label="Private screenings">
    <p className="theatre-warning">Protected screenings · Test membership access.</p>
    <h2>Screenings</h2>
    {!videos.length && <p>No screenings have been published yet.</p>}
    <div className="theatre-library">{videos.map(video => <article className="theatre-card" key={video.id}>
      <button className="theatre-card-button" onClick={() => { void play(video.id); }} aria-label={`Watch ${video.title}`} aria-haspopup="dialog">
        <VideoPoster src={thumbnails[video.id]} />
        <span className="theatre-card-copy">
          <span className="theatre-card-label">{video.isSample ? "Sample screening" : "Members only"}</span>
          <span className="theatre-card-title">{video.title}</span>
          {video.description?.trim() && <span className="theatre-card-description">{video.description.trim()}</span>}
          <span className="theatre-card-action">Watch screening <span aria-hidden="true">↗</span></span>
        </span>
      </button>
    </article>)}</div>
    <dialog ref={dialog} className="theatre-player-dialog" aria-labelledby="screening-title"
      onCancel={event => { event.preventDefault(); closePlayer(); }}>
      {videoId && <>
        <header className="theatre-player-header">
          <div><p className="theatre-card-label">Private screening</p><h2 id="screening-title">{selectedVideo?.title}</h2></div>
          <button ref={closeButton} className="theatre-player-close" type="button" aria-label="Close video" onClick={closePlayer}>×</button>
        </header>
        {playback ? <MuxPlayer key={videoId} playbackId={playback.playbackId} tokens={playback.tokens} streamType="on-demand" accentColor="#d4af37"
          autoPlay playsInline preload="metadata" disableCookies
          metadata={{ video_id: selectedVideo?.id, video_title: selectedVideo?.title, player_name: "Continental Theatre" }}
          title={selectedVideo?.title}
          style={{ "--cast-button": "none", "--airplay-button": "none" }}
          onError={() => setMessage("Protected playback is unavailable. Please try a supported browser or contact support.")} />
          : <div className="theatre-player-loading" role="status">{busy ? "Opening your screening…" : "Screening unavailable."}</div>}
        {message && <div className="theatre-player-error" role="alert"><p>{message}</p>
          <button disabled={busy} onClick={() => { void play(videoId); }}>Try again</button></div>}
        {selectedVideo?.description?.trim() && <p className="theatre-player-description">{selectedVideo.description.trim()}</p>}
      </>}
    </dialog>
  </section>;
}
