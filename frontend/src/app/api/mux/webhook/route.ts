import { NextResponse } from "next/server";
import { limitedBody } from "@/server/checkout/http";
import { mux } from "@/server/theatre/mux";
import { deleteMuxCatalogueVideo, syncMuxCatalogueVideo, validMuxAssetId } from "@/server/theatre/catalogue";
export const runtime = "nodejs";
export async function POST(request: Request) {
  if (!process.env.MUX_WEBHOOK_SECRET) return NextResponse.json({ error: "Not configured." }, { status: 503 });
  let event;
  try {
    event = await mux().webhooks.unwrap(await limitedBody(request, 256000), request.headers, process.env.MUX_WEBHOOK_SECRET);
  } catch { return NextResponse.json({ error: "Invalid webhook." }, { status: 400 }); }
  try {
    if (["video.asset.ready", "video.asset.updated", "video.asset.errored", "video.asset.deleted"].includes(event.type)) {
      const data = event.data as { id?: string };
      if (!validMuxAssetId(data?.id)) return NextResponse.json({ error: "Invalid asset event." }, { status: 400 });
      if (event.type === "video.asset.deleted") await deleteMuxCatalogueVideo(data.id);
      else await syncMuxCatalogueVideo(data.id);
    }
    return NextResponse.json({ received: true });
  } catch { return NextResponse.json({ error: "Video synchronization requires a retry." }, { status: 500 }); }
}
