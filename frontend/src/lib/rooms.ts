import type { NormalizedRect } from "./coverFit";

/**
 * The room registry — the single place a room is declared.
 *
 * Adding a room to the mansion means adding a row here: the foyer hotspot, the
 * mobile list entry, and the coming-soon state all read from this array. No
 * component needs editing.
 */

export type RoomStatus = "live" | "coming-soon";

export interface Room {
  /** Stable key. Also the calibration handle — see CALIBRATION below. */
  id: string;
  /** Accessible name, and the entry shown in the mobile list. */
  label: string;
  /**
   * Optional shorter text for the plaque above the door. The side doors are
   * only ~4% of the frame wide, so a long name either shrinks past reading or
   * overhangs the doorway — set this to keep the sign proportionate without
   * shortening the room's actual name.
   */
  plaqueLabel?: string;
  /**
   * "raised" gives the lettering an extruded, three-dimensional treatment.
   * Worth it on a wide door with room to carry it; on the narrow side doors the
   * extrusion crowds the glyphs at that size, so they stay flat.
   */
  plaqueStyle?: "flat" | "raised";
  /** Where the door leads. Ignored while `status` is "coming-soon". */
  route: string;
  status: RoomStatus;
  /**
   * The door's rectangle on the foyer frame, as 0–1 fractions of the source
   * image — never pixels, never viewport percentages. See lib/coverFit.
   */
  rect: NormalizedRect;
}

/**
 * Aspect ratio of the foyer frame the rectangles were measured against.
 * The sequence frames (1920x1072) and the 4K hero stills (3852x2152) share
 * this ratio, so one set of fractions is valid for both.
 */
export const FOYER_SOURCE = { width: 1920, height: 1072 } as const;

/**
 * Doors outside this central band get cropped away on tall-ish screens — a
 * 16:10 laptop loses roughly the outer 5% of each side, and a short window more
 * than that. Anything placed beyond the band is simply not reachable there, so
 * the calibration overlay flags rows that stray outside it.
 */
export const SAFE_BAND = { min: 0.125, max: 0.875 } as const;

/**
 * Rectangles were captured against the foyer frame via `/?calibrate` — load
 * that URL and click a door's opposite corners to measure a new one.
 *
 * The two side doors came out the same height and near-symmetric about the
 * centre line, which is the sanity check that they were measured rather than
 * guessed.
 */
export const ROOMS: readonly Room[] = [
  {
    id: "theatre",
    label: "Theatre Room",
    route: "/theatre",
    status: "live",
    // Calibrated — left-hand side door.
    rect: { x: 0.3548, y: 0.5595, width: 0.0466, height: 0.2134 },
  },
  {
    id: "office",
    label: "Don Wick's Office",
    plaqueStyle: "raised",
    route: "/office",
    status: "live",
    // Calibrated against the foyer frame.
    rect: { x: 0.4544, y: 0.4837, width: 0.0992, height: 0.2908 },
  },
  {
    id: "merch",
    label: "Merch Room",
    route: "/merch",
    status: "live",
    // Calibrated — right-hand side door.
    rect: { x: 0.6076, y: 0.5585, width: 0.0448, height: 0.2134 },
  },
];

export const liveRooms = () => ROOMS.filter((room) => room.status === "live");
