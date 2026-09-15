import Navbar from "@/components/Navbar/Navbar";
import RoomDoors from "@/components/RoomDoors/RoomDoors";
import ScrollSequence from "@/components/ScrollSequence/ScrollSequence";
import { FOYER_VIDEOS } from "@/lib/foyerVideos";

export default function Home() {
  return (
    <>
      <Navbar />
      {/* The doors ride in the sequence's overlay — revealed, and made
          clickable, only once the scroll lands on the foyer. */}
      <ScrollSequence frameCount={193} scrollHeightVh={500} foyerVideos={FOYER_VIDEOS}>
        <RoomDoors />
      </ScrollSequence>
    </>
  );
}
