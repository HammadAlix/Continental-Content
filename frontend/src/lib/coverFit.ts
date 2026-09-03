/**
 * Geometry for `object-fit: cover`, computed rather than delegated to CSS.
 *
 * The stage is full-bleed, so the frame is always scaled up until it covers the
 * viewport and the overflow is cropped away. That crop is the whole problem:
 * the painted image is wider (or taller) than the box containing it, and its
 * origin sits at a negative offset. Anything positioned against the *box* —
 * a hotspot at `left: 45%`, say — drifts off the thing it is supposed to be
 * pinned to as soon as the window stops matching the frame's aspect ratio.
 *
 * So the canvas and the door hotspots both resolve their coordinates through
 * here, off the same numbers, and stay locked together at every window shape.
 */

export interface CoverFit {
  /** Multiplier applied to the source to make it cover the container. */
  scale: number;
  /** Painted size, at least one axis larger than the container. */
  drawWidth: number;
  drawHeight: number;
  /** Top-left of the painted image relative to the container. Zero or negative. */
  offsetX: number;
  offsetY: number;
}

/** A region of the source image, in 0–1 fractions of its width and height. */
export interface NormalizedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function coverFit(
  containerWidth: number,
  containerHeight: number,
  sourceWidth: number,
  sourceHeight: number
): CoverFit {
  const scale = Math.max(
    containerWidth / sourceWidth,
    containerHeight / sourceHeight
  );

  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;

  return {
    scale,
    drawWidth,
    drawHeight,
    offsetX: (containerWidth - drawWidth) / 2,
    offsetY: (containerHeight - drawHeight) / 2,
  };
}

/** Place a normalized region onto the painted image, in container pixels. */
export function projectRect(rect: NormalizedRect, fit: CoverFit) {
  return {
    left: fit.offsetX + rect.x * fit.drawWidth,
    top: fit.offsetY + rect.y * fit.drawHeight,
    width: rect.width * fit.drawWidth,
    height: rect.height * fit.drawHeight,
  };
}

/** Inverse of {@link projectRect} — a click in the container, back to source fractions. */
export function normalizePoint(
  clientX: number,
  clientY: number,
  fit: CoverFit
) {
  return {
    x: (clientX - fit.offsetX) / fit.drawWidth,
    y: (clientY - fit.offsetY) / fit.drawHeight,
  };
}

/**
 * Whether a region survives the crop at the current window shape. A door in the
 * outer margins of a 16:9 frame is genuinely gone on a 16:10 laptop — not
 * mispositioned, absent — so callers need to be able to ask.
 */
export function isRectVisible(
  rect: NormalizedRect,
  fit: CoverFit,
  containerWidth: number,
  containerHeight: number
) {
  const { left, top, width, height } = projectRect(rect, fit);
  return (
    left >= 0 &&
    top >= 0 &&
    left + width <= containerWidth &&
    top + height <= containerHeight
  );
}
