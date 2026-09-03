/**
 * Base URL for heavy media — frames, audio, video.
 *
 * `assetPrefix` in next.config only rewrites `/_next/static/*`; files in
 * `public/` are explicitly not covered, so the prefix has to be applied by
 * hand. Everything that isn't a few-KB icon goes through here.
 *
 * Unset in development, so paths stay local and relative. In production this
 * points at the CDN/object-storage origin, which keeps ~70MB of frames and
 * video off the app server entirely.
 */
const MEDIA_BASE = (process.env.NEXT_PUBLIC_MEDIA_BASE_URL ?? "").replace(
  /\/$/,
  ""
);

/** Resolve a root-relative media path against the configured media origin. */
export const mediaUrl = (path: string) =>
  `${MEDIA_BASE}${path.startsWith("/") ? path : `/${path}`}`;
