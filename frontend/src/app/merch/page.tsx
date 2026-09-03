import type { Metadata } from "next";
import { assets } from "@/assets/assets";
import BackToFoyer from "@/components/BackToFoyer/BackToFoyer";
import Navbar from "@/components/Navbar/Navbar";
import RoomBackdrop from "@/components/RoomBackdrop/RoomBackdrop";
import RoomIntro from "@/components/RoomIntro/RoomIntro";
import "../room-page.css";

export const metadata: Metadata = {
  title: "Merch Room — Continental Content",
  description:
    "The Continental Content wardrobe: jackets, hoodies and tees on display.",
};

export default function MerchPage() {
  return (
    <>
      <Navbar />
      <BackToFoyer />

      <main className="room-page">
        {/* The wardrobe is dead symmetrical around the mirror — a side-weighted
            scrim would visibly tilt it, so the wash comes up from the floor. */}
        <RoomBackdrop src={assets.merchRoom} scrim="bottom" focus="center 50%" />

        {/* Placeholder copy — replace once the catalogue exists. */}
        <RoomIntro eyebrow="The Wardrobe" heading="Merch Room" />
      </main>
    </>
  );
}
