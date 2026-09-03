"use client";

import type { RoomStatus } from "@/lib/rooms";
import "./DoorHotspot.css";

interface DoorHotspotProps {
  label: string;
  top: string;
  left: string;
  width: string;
  height: string;
  onClick: () => void;
  /** Fires on hover and on keyboard focus — somewhere to warm the destination. */
  onHover?: () => void;
  /** "coming-soon" renders visible but inert. Defaults to "live". */
  status?: RoomStatus;
}

export default function DoorHotspot({
  label,
  top,
  left,
  width,
  height,
  onClick,
  onHover,
  status = "live",
}: DoorHotspotProps) {
  const pending = status === "coming-soon";

  return (
    <button
      className={`door-hotspot${pending ? " is-pending" : ""}`}
      style={{ top, left, width, height }}
      onClick={pending ? undefined : onClick}
      onMouseEnter={onHover}
      onFocus={onHover}
      disabled={pending}
      aria-label={pending ? `${label} — coming soon` : label}
    />
  );
}
