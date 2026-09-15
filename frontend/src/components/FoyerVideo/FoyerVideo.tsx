"use client";

import { useEffect, useRef, useState } from "react";
import { mediaUrl } from "@/lib/media";
import { coverFit, projectRect } from "@/lib/coverFit";
import { FOYER_SOURCE } from "@/lib/rooms";
import "./FoyerVideo.css";

export default function FoyerVideo({
  sources,
  active,
}: {
  sources: readonly string[];
  active: boolean;
}) {
  const [index, setIndex] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<React.CSSProperties>();

  useEffect(() => {
    const stage = panelRef.current?.parentElement;
    if (!stage) return;

    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      const fit = coverFit(width, height, FOYER_SOURCE.width, FOYER_SOURCE.height);
      // Wider screen, keeping the original centre and clearance above the office sign.
      const rect = projectRect({ x: 0.429, y: 0.242, width: 0.15, height: 0.188 }, fit);
      setPlacement({
        "--reel-left": `${rect.left}px`,
        "--reel-top": `${rect.top}px`,
        "--reel-width": `${rect.width}px`,
        "--reel-height": `${rect.height}px`,
      } as React.CSSProperties);
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);
  const source = sources[index % (sources.length || 1)];
  const url = source
    ? /^https?:\/\//i.test(source) ? source : mediaUrl(source)
    : undefined;

  return (
    <div ref={panelRef} style={placement} className="foyer-video" aria-label="Continental Content video showcase">
      <div className="foyer-video-frame">
        {active && url ? (
          <Reel
            key={url}
            src={url}
            loop={sources.length === 1}
            onEnded={() => setIndex((current) => (current + 1) % sources.length)}
          />
        ) : (
          <div className="foyer-video-placeholder">
            <span className="foyer-video-monogram" aria-hidden="true">C</span>
            <span className="foyer-video-title">The Continental Reel</span>
            <span className="foyer-video-note">Coming soon</span>
          </div>
        )}
      </div>
    </div>
  );
}

function Reel({ src, loop, onEnded }: {
  src: string;
  loop: boolean;
  onEnded: () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    // Keep the decorative reel playing whenever its foyer panel is visible.
    if (!document.hidden) {
      video.play().catch(() => {});
    }
    let resume = false;
    const onVisibility = () => {
      if (document.hidden) {
        resume = !video.paused;
        video.pause();
      } else if (resume) {
        video.play().catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      video.pause();
    };
  }, []);

  if (failed) {
    return <div className="foyer-video-placeholder" role="status">The reel is temporarily unavailable.</div>;
  }

  return (
    <video
      ref={ref}
      src={src}
      autoPlay
      muted
      playsInline
      loop={loop}
      preload="metadata"
      aria-label="The Continental Reel"
      onCanPlay={(event) => event.currentTarget.play().catch(() => {})}
      onEnded={onEnded}
      onError={() => setFailed(true)}
    />
  );
}
