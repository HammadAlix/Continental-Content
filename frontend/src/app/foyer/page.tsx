"use client";

import { useRouter } from "next/navigation";
import VideoHub from "@/components/VideoHub/VideoHub";
import DoorHotspot from "@/components/DoorHotspot/DoorHotspot";

export default function FoyerPage() {
  const router = useRouter();

  return (
    <div style={{ position: "relative" }}>
      <VideoHub src="/videos/foyer-loop.mp4" />
      <DoorHotspot
        label="Don Wick's Office"
        top="40%"
        left="45%"
        width="10%"
        height="30%"
        onClick={() => router.push("/office")}
      />
      <DoorHotspot
        label="Theatre Room"
        top="40%"
        left="20%"
        width="10%"
        height="30%"
        onClick={() => router.push("/theatre")}
      />
      <DoorHotspot
        label="Merch Room"
        top="40%"
        left="70%"
        width="10%"
        height="30%"
        onClick={() => router.push("/merch")}
      />
    </div>
  );
}
