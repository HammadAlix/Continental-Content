"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { connectFoyerAudio, isMusicRoomPath, type SoundState } from "./controller";
import "./FoyerAudio.css";

export default function FoyerAudio() {
  const pathname = usePathname();
  const audio = useRef<HTMLAudioElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const connection = useRef<ReturnType<typeof connectFoyerAudio> | null>(null);
  const [state, setState] = useState<SoundState>("off");

  useEffect(() => {
    if (!audio.current || !button.current) return;
    const controller = connectFoyerAudio(audio.current, button.current, setState);
    connection.current = controller;
    return () => { connection.current = null; controller.dispose(); };
  }, []);

  useEffect(() => {
    connection.current?.setRoomActive(isMusicRoomPath(pathname));
  }, [pathname]);

  const active = state === "on" || state === "loading" || state === "paused";
  const label = active ? "Mute background music" : state === "error"
    ? "Retry background music" : "Turn background music on";
  return (
    <>
      <audio ref={audio} src="/audio/Moonlight%20Sonata.m4a" loop preload="none" />
      <button ref={button} type="button" className="foyer-sound"
        hidden={!isMusicRoomPath(pathname)} data-room={pathname}
        aria-label={label} aria-pressed={active} title={label}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M11 5 6 9H3v6h3l5 4V5Z" />
          {active ? <><path d="M15 8a6 6 0 0 1 0 8" /><path d="M18 5a10 10 0 0 1 0 14" /></>
            : <path d="m16 9 6 6m0-6-6 6" />}
        </svg>
        <span>{state === "loading" ? "Loading…" : state === "on" ? "Sound on" : state === "paused" ? "Music paused"
          : state === "error" ? "Retry sound" : "Sound off"}</span>
      </button>
    </>
  );
}
