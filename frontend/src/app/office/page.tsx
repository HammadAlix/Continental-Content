import type { Metadata } from "next";
import { assets } from "@/assets/assets";
import BackToFoyer from "@/components/BackToFoyer/BackToFoyer";
import Navbar from "@/components/Navbar/Navbar";
import RoomBackdrop from "@/components/RoomBackdrop/RoomBackdrop";
import ServiceRequest from "@/components/ServiceRequest/ServiceRequest";
import "./office.css";

export const metadata: Metadata = {
  title: "Don Wick's Office — Continental Content",
  description:
    "Leave a service request at the desk: collaborations, sponsorships, commissions and press.",
};

export default function OfficePage() {
  return (
    <>
      <Navbar />
      <BackToFoyer />

      <main className="office">
        <RoomBackdrop src={assets.donWickOffice} scrim="right" />

        <div className="office-content">
          <header className="office-intro">
            <span className="office-eyebrow">Don Wick&apos;s Office</span>
            <h1 className="office-heading">
              Business is conducted <em>at the desk</em>
            </h1>
            <p className="office-copy">
              The chair is empty and the fire is lit, which means the room is
              open. Requests left here are read in the order they arrive.
            </p>
          </header>

          <ServiceRequest />
        </div>
      </main>
    </>
  );
}
