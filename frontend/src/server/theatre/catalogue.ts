import "server-only";
import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { theatreVideos } from "@/server/db/schema";
import { mux, protectedPlaybackId } from "./mux";

const importedId = (assetId: string) => `mux-${assetId}`;
export const validMuxAssetId = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,255}$/.test(value);

/** Keep a tombstone even when deletion arrives before the asset's ready event. */
export async function deleteMuxCatalogueVideo(assetId: string) {
  if (!validMuxAssetId(assetId)) throw new Error("Invalid Mux asset ID.");
  await db().insert(theatreVideos).values({
    id: importedId(assetId), muxAssetId: assetId, title: "Deleted screening", description: "",
    status: "deleted", playbackId: null, published: false, isSample: false,
  }).onConflictDoUpdate({ target: theatreVideos.muxAssetId,
    set: { status: "deleted", playbackId: null, published: false },
  });
}

/** Signed webhook data is only a notification: re-fetch truth from our Mux environment. */
export async function syncMuxCatalogueVideo(assetId: string) {
  if (!validMuxAssetId(assetId)) throw new Error("Invalid Mux asset ID.");
  let asset;
  try { asset = await mux().video.assets.retrieve(assetId); }
  catch (error) {
    if (error instanceof Error && "status" in error && error.status === 404) {
      await deleteMuxCatalogueVideo(assetId);
      return;
    }
    throw error; // Provider failures must be retried, not interpreted as deletion.
  }
  if (asset.id !== assetId) throw new Error("Mux asset mismatch.");
  const playbackId = protectedPlaybackId(asset);
  const title = asset.meta?.title?.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 512);
  const state = { status: playbackId ? "ready" : "unavailable", playbackId };
  const database = db();
  const id = importedId(assetId);
  if (!playbackId || process.env.MUX_AUTO_IMPORT_ENABLED !== "true") {
    // Never add an unsafe new asset; hide unsafe existing assets via their status.
    await database.update(theatreVideos).set({ ...state, ...(title ? { title } : {}) })
      .where(and(eq(theatreVideos.muxAssetId, assetId), ne(theatreVideos.status, "deleted")));
    return;
  }
  await database.insert(theatreVideos).values({
    id, muxAssetId: assetId, title: title || "Untitled screening", description: "",
    ...state, published: true, isSample: false,
  }).onConflictDoUpdate({
    target: theatreVideos.muxAssetId,
    set: {
      ...state, ...(title ? { title } : {}),
      // Auto-imported videos are managed in Mux. Preserve manual publication decisions.
      published: sql`case when ${theatreVideos.id} = ${id} then true else ${theatreVideos.published} end`,
    },
    // A delayed ready/title event must never resurrect a deleted asset.
    setWhere: ne(theatreVideos.status, "deleted"),
  });
}
