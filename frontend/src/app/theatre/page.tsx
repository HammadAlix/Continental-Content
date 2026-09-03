import type { Metadata } from "next";
import { assets } from "@/assets/assets";
import BackToFoyer from "@/components/BackToFoyer/BackToFoyer";
import Navbar from "@/components/Navbar/Navbar";
import RoomBackdrop from "@/components/RoomBackdrop/RoomBackdrop";
import RoomIntro from "@/components/RoomIntro/RoomIntro";
import "../room-page.css";

export const metadata: Metadata = {
  title: "Theatre Room — Continental Content",
  description: "The Continental Content screening room.",
};

export default function TheatrePage() {
  return (
    <>
      <Navbar />
      <BackToFoyer />

      <main className="room-page">
        {/* Symmetrical about the proscenium, and the crest sits high in the
            arch — so the crop holds above centre to keep it in frame on short
            windows, and the wash comes up off the aisle carpet. */}
        <RoomBackdrop
          src={assets.theatreRoom}
          scrim="bottom"
          focus="center 42%"
        />

        {/* Placeholder copy — replace once the programme exists. */}
        <RoomIntro eyebrow="The Screening Room" heading="Theatre Room" />
      </main>
    </>
  );
}
