import "server-only";
import Mux from "@mux/ts";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/server/db/client";
import { theatreVideos } from "@/server/db/schema";
import { checkoutOrigin } from "@/server/checkout/stripe";

export function mux() {
  if (!process.env.MUX_TOKEN_ID || !process.env.MUX_TOKEN_SECRET) throw new Error("Mux is not configured.");
  return new Mux({ timeout: 15000, maxRetries: 1 });
}

export function protectedPlaybackId(asset: Mux.Video.Assets.Asset): string | null {
  const drm = asset.playback_ids?.find(id => id.policy === "drm");
  // Never return a public/signed non-DRM fallback, even if accidentally added.
  const hasUnprotectedPlayback = asset.playback_ids?.some(id => id.policy !== "drm");
  const hasDownload = asset.master_access === "temporary" ||
    (asset.mp4_support && asset.mp4_support !== "none") ||
    (asset.static_renditions?.files?.length ?? 0) > 0 ||
    ["ready", "preparing"].includes(asset.static_renditions?.status ?? "");
  const safe = asset.status === "ready" && drm && !hasUnprotectedPlayback && !hasDownload;
  return safe ? drm.id : null;
}

export async function syncTheatreVideo(assetId: string) {
  const asset = await mux().video.assets.retrieve(assetId);
  const playbackId = protectedPlaybackId(asset);
  await db().update(theatreVideos).set({ status: playbackId ? "ready" : "unavailable", playbackId })
    .where(and(eq(theatreVideos.muxAssetId, assetId), ne(theatreVideos.status, "deleted")));
  return playbackId;
}

export async function verifiedPlaybackRestriction() {
  const id = process.env.MUX_PLAYBACK_RESTRICTION_ID;
  if (!id) throw new Error("Playback restrictions are not configured.");
  const restriction = await mux().video.playbackRestrictions.retrieve(id);
  const domains = restriction.referrer.allowed_domains;
  // One exact origin per deployment; do not silently permit all Vercel previews,
  // missing referrers, native/casting clients, or a weakened dashboard policy.
  if (restriction.id !== id || domains?.length !== 1 || domains[0] !== new URL(checkoutOrigin()).hostname ||
    // Mux may omit false; its documented default for this field is false.
    (restriction.referrer.allow_no_referrer !== false && restriction.referrer.allow_no_referrer !== undefined) ||
    restriction.user_agent.allow_no_user_agent !== false || restriction.user_agent.allow_high_risk_user_agent !== false) {
    throw new Error("Playback restriction does not match this website's security policy.");
  }
  return id;
}

function tokenExpiration(paidThrough: Date) {
  if (!process.env.MUX_SIGNING_KEY || !process.env.MUX_PRIVATE_KEY) throw new Error("Playback signing is not configured.");
  if (!Number.isFinite(paidThrough.getTime()) || paidThrough.getTime() <= Date.now()) throw new Error("Membership expired.");
  const remaining = Math.floor((paidThrough.getTime() - Date.now()) / 1000);
  if (remaining < 1) throw new Error("Membership expired.");
  return `${Math.min(300, remaining)}s`;
}

/** Thumbnail-only tokens cannot authorize video or DRM licences. No public image fallback. */
export async function theatreThumbnails(videos: { id: string; playbackId: string | null }[], paidThrough: Date) {
  if (!videos.length) return {};
  const restriction = await verifiedPlaybackRestriction();
  const expiration = tokenExpiration(paidThrough);
  const client = mux();
  const entries = await Promise.all(videos.filter(video => video.playbackId).map(async video => {
    const token = await client.jwt.signPlaybackId(video.playbackId!, {
      type: "thumbnail", expiration,
      params: { playback_restriction_id: restriction, width: "640", height: "360", fit_mode: "crop" },
    });
    return [video.id, `https://image.mux.com/${encodeURIComponent(video.playbackId!)}/thumbnail.webp?token=${encodeURIComponent(token)}`];
  }));
  return Object.fromEntries(entries) as Record<string, string>;
}

export async function playbackTokens(playbackId: string, paidThrough: Date) {
  return signPlaybackTokens(playbackId, paidThrough, await verifiedPlaybackRestriction());
}

/** Call only after fresh membership and published-video authorization in the route. */
export async function protectedAssetPlayback(assetId: string, paidThrough: Date) {
  // These independent provider checks remain fresh on EVERY start/renewal.
  // Promise.all observes both failures; neither branch issues tokens on its own.
  const [playbackId, restriction] = await Promise.all([
    syncTheatreVideo(assetId),
    verifiedPlaybackRestriction(),
  ]);
  if (!playbackId) return null;
  return { playbackId, tokens: await signPlaybackTokens(playbackId, paidThrough, restriction) };
}

// Private: callers cannot skip restriction verification by supplying an arbitrary ID.
async function signPlaybackTokens(playbackId: string, paidThrough: Date, restriction: string) {
  const params = { playback_restriction_id: restriction };
  // Re-check expiry AFTER the provider checks, immediately before signing.
  const expiration = tokenExpiration(paidThrough);
  const client = mux();
  const [playback, drm, thumbnail, storyboard] = await Promise.all([
    client.jwt.signPlaybackId(playbackId, { expiration, params }),
    client.jwt.signDrmLicense(playbackId, { expiration, params }),
    client.jwt.signPlaybackId(playbackId, { expiration, params, type: "thumbnail" }),
    client.jwt.signPlaybackId(playbackId, { expiration, params, type: "storyboard" }),
  ]);
  return { playback, drm, thumbnail, storyboard };
}
