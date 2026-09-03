"use client";

import { useRef } from "react";
import "./VideoHub.css";

interface VideoHubProps {
  src: string;
  loop?: boolean;
}

export default function VideoHub({ src, loop = true }: VideoHubProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  return (
    <div className="video-hub">
      <video
        ref={videoRef}
        src={src}
        autoPlay
        muted
        loop={loop}
        playsInline
        className="video-hub-video"
      />
    </div>
  );
}
