import type { Metadata } from "next";
import BackToFoyer from "@/components/BackToFoyer/BackToFoyer";
import Navbar from "@/components/Navbar/Navbar";
import MerchRoom from "@/components/MerchRoom/MerchRoom";
import { getPublicCatalogue } from "@/server/merch/catalogue";
import "../room-page.css";

export const metadata: Metadata = {
  title: "Merch Room — Continental Content",
  description:
    "The Continental Content wardrobe: jackets, hoodies and tees on display.",
};

export const dynamic = "force-dynamic";
export default async function MerchPage() {
  let products;
  try { products = await getPublicCatalogue(); }
  catch { return <main className="room-page"><Navbar /><BackToFoyer /><p role="alert" style={{ margin: "140px auto", padding: 24 }}>The wardrobe is temporarily unavailable. Please refresh shortly.</p></main>; }
  return (
    <>
      <Navbar />
      <BackToFoyer />

      <main className="room-page">
        <MerchRoom products={products} />
      </main>
    </>
  );
}
