import { eq, and } from "drizzle-orm";
import { theatreRequest, theatreJson } from "@/server/theatre/http";
import { getMembership } from "@/server/theatre/membership";
import { protectedAssetPlayback } from "@/server/theatre/mux";
import { db } from "@/server/db/client";
import { theatreVideos } from "@/server/db/schema";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const result = await theatreRequest(request, "playback", 20);
    if (result.response) return result.response;
    const membership = await getMembership(result.member.id);
    if (!membership.active || !membership.paidThrough) return theatreJson({ error: "An active paid membership is required." }, 403);
    const { id } = await context.params;
    const [video] = await db().select().from(theatreVideos).where(and(eq(theatreVideos.id, id), eq(theatreVideos.published, true)));
    if (!video) return theatreJson({ error: "Video not found." }, 404);
    const playback = await protectedAssetPlayback(video.muxAssetId, membership.paidThrough);
    if (!playback) return theatreJson({ error: "Protected video is not ready." }, 409);
    return theatreJson(playback);
  } catch { return theatreJson({ error: "Protected playback is temporarily unavailable." }, 503); }
}
