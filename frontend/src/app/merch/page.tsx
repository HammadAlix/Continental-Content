import type { Metadata } from "next";
import BackToFoyer from "@/components/BackToFoyer/BackToFoyer";
import Navbar from "@/components/Navbar/Navbar";
import MerchRoom from "@/components/MerchRoom/MerchRoom";
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
        <MerchRoom />
      </main>
    </>
  );
}
