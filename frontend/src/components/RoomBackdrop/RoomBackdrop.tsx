"use client";

import { useState } from "react";
import Image, { type StaticImageData } from "next/image";
import "./RoomBackdrop.css";

interface RoomBackdropProps {
  src: StaticImageData;
  /**
   * Where the scrim puts its weight — wherever the page's content sits.
   * "right" for a side column, "bottom" for a centred block.
   */
  scrim?: "right" | "bottom";
  /**
   * Cover focal point. Rooms are shot wide with the subject low, so the
   * default keeps furniture in frame instead of ceiling.
   */
  focus?: string;
}

/**
 * A room, revealed rather than switched on.
 *
 * The entrance is driven by the image's own load event rather than a timer.
 * Animating on mount would mean opening on an empty frame and having the room
 * appear partway through — worse than no animation at all. Waiting for the
 * decode means the push-in always plays over an actual picture, however long
 * the download took.
 */
export default function RoomBackdrop({
  src,
  scrim = "right",
  focus = "center 62%",
}: RoomBackdropProps) {
  const [ready, setReady] = useState(false);

  return (
    // Passed as a custom property on the wrapper rather than object-position on
    // the image: an inline style would outrank every media query, and the crop
    // is exactly the thing a page needs to retune on a portrait screen.
    <div
      className={`room-backdrop${ready ? " is-ready" : ""}`}
      style={{ "--room-focus": focus } as React.CSSProperties}
    >
      <Image
        src={src}
        alt=""
        fill
        priority
        sizes="100vw"
        className="room-backdrop-img"
        onLoad={() => setReady(true)}
      />
      <div className={`room-scrim room-scrim--${scrim}`} />
    </div>
  );
}
