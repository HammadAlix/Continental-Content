import { and, eq, isNotNull } from "drizzle-orm";
import { theatreRequest, theatreJson } from "@/server/theatre/http";
import { getMembershipSnapshot } from "@/server/theatre/membership";
import { theatreThumbnails } from "@/server/theatre/mux";
import { db } from "@/server/db/client";
import { theatreVideos } from "@/server/db/schema";

export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const result = await theatreRequest(request, "thumbnails", 12);
    if (result.response) return result.response;
    const membership = await getMembershipSnapshot(result.member.id);
    if (!membership.active || !membership.paidThrough) return theatreJson({ error: "An active paid membership is required." }, 403);
    const videos = await db().select({ id: theatreVideos.id, playbackId: theatreVideos.playbackId }).from(theatreVideos)
      .where(and(eq(theatreVideos.published, true), eq(theatreVideos.status, "ready"), isNotNull(theatreVideos.playbackId)));
    return theatreJson({ thumbnails: await theatreThumbnails(videos, membership.paidThrough) });
  } catch { return theatreJson({ error: "Screening previews are temporarily unavailable." }, 503); }
}
