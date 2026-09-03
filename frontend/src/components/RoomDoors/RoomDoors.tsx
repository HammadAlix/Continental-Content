"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useRouter } from "next/navigation";
import DoorHotspot from "@/components/DoorHotspot/DoorHotspot";
import {
  coverFit,
  isRectVisible,
  normalizePoint,
  projectRect,
  type CoverFit,
  type NormalizedRect,
} from "@/lib/coverFit";
import { FOYER_SOURCE, ROOMS, SAFE_BAND, type Room } from "@/lib/rooms";
import "./RoomDoors.css";

/**
 * The doors on the foyer frame.
 *
 * Positions live in lib/rooms as fractions of the source image and are projected
 * onto the painted frame through lib/coverFit — the same geometry the canvas
 * paints with, so a door stays on its doorway at every window shape.
 *
 * Below this width the hotspots are abandoned for a plain list. Not a layout
 * decision: a door occupying 10% of a 390px screen is a 39px tap target sitting
 * inside a hard-cropped frame, and no amount of positioning makes that a
 * reasonable thing to ask of a thumb.
 */
const LIST_BREAKPOINT = 768;

/**
 * The viewport and the URL are both state owned outside React, so they're read
 * through useSyncExternalStore rather than mirrored into an effect. Both report
 * `false` during prerender, which is what the server markup commits to, so
 * hydration stays consistent and the client corrects on its first read.
 */
function useMediaQuery(query: string) {
  return useSyncExternalStore(
    useCallback(
      (notify: () => void) => {
        const list = window.matchMedia(query);
        list.addEventListener("change", notify);
        return () => list.removeEventListener("change", notify);
      },
      [query]
    ),
    () => window.matchMedia(query).matches,
    () => false
  );
}

const NO_SUBSCRIPTION = () => () => {};

/** Presence of a query-string flag. Static for the life of the page. */
function useQueryFlag(name: string) {
  return useSyncExternalStore(
    NO_SUBSCRIPTION,
    () => new URLSearchParams(window.location.search).has(name),
    () => false
  );
}

export default function RoomDoors() {
  const router = useRouter();
  const stageRef = useRef<HTMLDivElement>(null);

  const [box, setBox] = useState({ width: 0, height: 0 });
  const asList = useMediaQuery(`(max-width: ${LIST_BREAKPOINT - 1}px)`);
  // Opt-in via `?calibrate`, read off location rather than useSearchParams so
  // this component doesn't drag a Suspense boundary onto a static page.
  const calibrating = useQueryFlag("calibrate");

  // Measured rather than assumed: the overlay fills the sticky stage, which is
  // 100vh, and on mobile browsers that is not the same number as innerHeight.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setBox({ width, height });
    });

    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  const fit =
    box.width && box.height
      ? coverFit(box.width, box.height, FOYER_SOURCE.width, FOYER_SOURCE.height)
      : null;

  const open = useCallback(
    (room: Room) => {
      router.push(room.route);
    },
    [router]
  );

  /**
   * These are buttons rather than links, so none of Link's automatic
   * prefetching applies. Warming the route on hover means the click lands on
   * something already fetched — without it the entrance animation plays over a
   * page that is still being assembled.
   */
  const warm = useCallback(
    (room: Room) => {
      if (room.status === "live") router.prefetch(room.route);
    },
    [router]
  );

  if (asList) {
    return (
      <div className="room-doors-list" ref={stageRef}>
        <span className="room-doors-list-title">Choose a room</span>
        <ul>
          {ROOMS.map((room) => (
            <li key={room.id}>
              <button
                onClick={() => open(room)}
                onTouchStart={() => warm(room)}
                disabled={room.status === "coming-soon"}
              >
                {room.label}
                {room.status === "coming-soon" && <em>Coming soon</em>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="room-doors" ref={stageRef}>
      {fit &&
        ROOMS.map((room) => {
          const { left, top, width, height } = projectRect(room.rect, fit);

          // Sized off the door rather than the viewport, so the lettering keeps
          // its proportion to the doorway at every window size. Clamped at both
          // ends: the side doors are narrow enough that pure proportion would
          // render them unreadable, the centre door wide enough to shout.
          const fontSize = Math.min(Math.max(width * 0.1, 10), 16);

          return (
            <div key={room.id}>
              <DoorHotspot
                label={room.label}
                status={room.status}
                top={`${top}px`}
                left={`${left}px`}
                width={`${width}px`}
                height={`${height}px`}
                onClick={() => open(room)}
                onHover={() => warm(room)}
              />

              {/* Decorative twin of the button's accessible name — announcing
                  it twice would just make the door read as two controls. */}
              {/* Every plaque also carries a per-room class, so any single door
                  can be nudged in CSS without touching the others. */}
              <div
                className={`room-doors-plaque room-doors-plaque--${room.id}`}
                aria-hidden="true"
                style={{
                  left: `${left + width / 2}px`,
                  top: `${top}px`,
                  width: `${Math.max(width * 1.5, 110)}px`,
                  fontSize: `${fontSize}px`,
                }}
              >
                <span
                  className={`room-doors-plaque-text${
                    room.plaqueStyle === "raised" ? " is-raised" : ""
                  }`}
                >
                  {room.plaqueLabel ?? room.label}
                </span>
                {room.status === "coming-soon" && (
                  <span className="room-doors-plaque-pending">Coming soon</span>
                )}
              </div>
            </div>
          );
        })}

      {calibrating && fit && (
        <CalibrationOverlay fit={fit} box={box} stageRef={stageRef} />
      )}
    </div>
  );
}

/**
 * Development aid: click the two opposite corners of a door on the frame and it
 * prints the registry row. Eyeballing these numbers by hand is an hour of
 * nudging; this is a couple of minutes.
 */
function CalibrationOverlay({
  fit,
  box,
  stageRef,
}: {
  fit: CoverFit;
  box: { width: number; height: number };
  stageRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [corner, setCorner] = useState<{ x: number; y: number } | null>(null);
  const [rows, setRows] = useState<string[]>([]);

  const round = (value: number) => Number(value.toFixed(4));

  const onClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const stage = stageRef.current;
    if (!stage) return;

    const bounds = stage.getBoundingClientRect();
    const point = normalizePoint(
      event.clientX - bounds.left,
      event.clientY - bounds.top,
      fit
    );

    if (!corner) {
      setCorner(point);
      return;
    }

    const rect: NormalizedRect = {
      x: round(Math.min(corner.x, point.x)),
      y: round(Math.min(corner.y, point.y)),
      width: round(Math.abs(point.x - corner.x)),
      height: round(Math.abs(point.y - corner.y)),
    };

    const outside =
      rect.x < SAFE_BAND.min || rect.x + rect.width > SAFE_BAND.max;

    setRows((previous) => [
      ...previous,
      `rect: { x: ${rect.x}, y: ${rect.y}, width: ${rect.width}, height: ${rect.height} },${
        outside ? " // OUTSIDE SAFE BAND — crops on 16:10" : ""
      }`,
    ]);
    setCorner(null);
  };

  const safeLeft = projectRect(
    { x: SAFE_BAND.min, y: 0, width: 0, height: 1 },
    fit
  );
  const safeRight = projectRect(
    { x: SAFE_BAND.max, y: 0, width: 0, height: 1 },
    fit
  );

  return (
    <div className="room-doors-calibrate" onClick={onClick}>
      {/* Where the frame actually is, and the band that survives cropping. */}
      <div
        className="room-doors-calibrate-frame"
        style={{
          left: `${fit.offsetX}px`,
          top: `${fit.offsetY}px`,
          width: `${fit.drawWidth}px`,
          height: `${fit.drawHeight}px`,
        }}
      />
      <div
        className="room-doors-calibrate-guide"
        style={{ left: `${safeLeft.left}px` }}
      />
      <div
        className="room-doors-calibrate-guide"
        style={{ left: `${safeRight.left}px` }}
      />

      {ROOMS.map((room) => {
        const placed = projectRect(room.rect, fit);
        const visible = isRectVisible(room.rect, fit, box.width, box.height);
        return (
          <div
            key={room.id}
            className={`room-doors-calibrate-rect${
              visible ? "" : " is-cropped"
            }`}
            style={{
              left: `${placed.left}px`,
              top: `${placed.top}px`,
              width: `${placed.width}px`,
              height: `${placed.height}px`,
            }}
          >
            {room.id}
            {!visible && " (cropped)"}
          </div>
        );
      })}

      <div className="room-doors-calibrate-panel" onClick={(e) => e.stopPropagation()}>
        <strong>
          {corner
            ? "Now click the BOTTOM-RIGHT corner"
            : "Click the TOP-LEFT corner of a door"}
        </strong>
        <span>
          {Math.round(box.width)}x{Math.round(box.height)} · frame{" "}
          {Math.round(fit.drawWidth)}x{Math.round(fit.drawHeight)}
        </span>
        {rows.length > 0 && (
          <>
            <pre>{rows.join("\n")}</pre>
            <div className="room-doors-calibrate-actions">
              <button
                onClick={() => navigator.clipboard?.writeText(rows.join("\n"))}
              >
                Copy
              </button>
              <button onClick={() => setRows([])}>Clear</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
