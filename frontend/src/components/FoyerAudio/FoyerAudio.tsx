"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { connectFoyerAudio, isFoyerPath, type SoundState } from "./controller";
import "./FoyerAudio.css";

function FoyerSoundControl() {
  const audio = useRef<HTMLAudioElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const [state, setState] = useState<SoundState>("off");

  useEffect(() => {
    if (!audio.current || !button.current) return;
    return connectFoyerAudio(audio.current, button.current, setState);
  }, []);

  const active = state === "on" || state === "loading";
  const label = active ? "Mute foyer music" : state === "error"
    ? "Retry foyer music" : "Turn foyer music on";
  return (
    <>
      <audio ref={audio} src="/audio/Moonlight%20Sonata.m4a" loop preload="none" />
      <button ref={button} type="button" className="foyer-sound"
        aria-label={label} aria-pressed={active} title={label}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M11 5 6 9H3v6h3l5 4V5Z" />
          {active ? <><path d="M15 8a6 6 0 0 1 0 8" /><path d="M18 5a10 10 0 0 1 0 14" /></>
            : <path d="m16 9 6 6m0-6-6 6" />}
        </svg>
        <span>{state === "loading" ? "Loading…" : state === "on" ? "Sound on"
          : state === "error" ? "Retry sound" : "Sound off"}</span>
      </button>
    </>
  );
}

export default function FoyerAudio() {
  const pathname = usePathname();
  // Unmounting pauses and releases the session on every non-foyer route.
  return isFoyerPath(pathname) ? <FoyerSoundControl /> : null;
}
