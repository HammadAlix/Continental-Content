import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import Link from "next/link";
import { assets } from "@/assets/assets";
import BackToFoyer from "@/components/BackToFoyer/BackToFoyer";
import Navbar from "@/components/Navbar/Navbar";
import RoomBackdrop from "@/components/RoomBackdrop/RoomBackdrop";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { theatreEntrance } from "@/server/theatre/entrance";
import { theatreThumbnails } from "@/server/theatre/mux";
import { db } from "@/server/db/client";
import { theatreVideos } from "@/server/db/schema";
import TheatreScreenings from "@/components/TheatreMembership/TheatreScreenings";
import "../room-page.css";
import "./theatre.css";

export const metadata: Metadata = {
  title: "Theatre Room — Continental Content",
  description: "The Continental Content screening room.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";
export default async function TheatrePage() {
  const { destination, paidThrough } = await theatreEntrance();
  if (destination) redirect(destination);
  if (!paidThrough || paidThrough <= new Date()) redirect("/membership");
  let videos;
  try {
    videos = await db().select({ id: theatreVideos.id, title: theatreVideos.title,
      description: theatreVideos.description, isSample: theatreVideos.isSample, playbackId: theatreVideos.playbackId })
      .from(theatreVideos).where(and(eq(theatreVideos.published, true), eq(theatreVideos.status, "ready")));
  } catch { redirect("/account/theatre?notice=unavailable"); }
  let initialThumbnails: Record<string, string> = {};
  try { initialThumbnails = await theatreThumbnails(videos, paidThrough); }
  catch { /* A preview failure leaves cards usable; playback still verifies independently. */ }
  if (paidThrough <= new Date()) redirect("/membership");
  // eslint-disable-next-line react-hooks/purity -- Per-request timestamp in a force-dynamic SERVER page, serialized to the client.
  const initialCheckedAt = Date.now();
  return (
    <ClerkProvider signInUrl="/sign-in" signUpUrl="/sign-up">
      <Navbar />

      <main className="room-page theatre-room-private">
        {/* Symmetrical about the proscenium, and the crest sits high in the
            arch — so the crop holds above centre to keep it in frame on short
            windows, and the wash comes up off the aisle carpet. */}
        <RoomBackdrop
          src={assets.theatreRoom}
          scrim="bottom"
          focus="center 42%"
        />

        <section className="theatre-room-content">
          <p className="theatre-room-eyebrow">Members only · The screening room</p>
          <h1>Theatre Room</h1>
          <Link className="theatre-account-link" href="/account/theatre">Manage membership</Link>
          <TheatreScreenings videos={videos.map(({ id, title, description, isSample }) => ({ id, title, description, isSample }))}
            initialThumbnails={initialThumbnails} initialPaidThrough={paidThrough.toISOString()} initialCheckedAt={initialCheckedAt} />
          <div className="theatre-exit"><BackToFoyer /></div>
        </section>
      </main>
    </ClerkProvider>
  );
}
