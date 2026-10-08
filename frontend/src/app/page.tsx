import Navbar from "@/components/Navbar/Navbar";
import RoomDoors from "@/components/RoomDoors/RoomDoors";
import ScrollSequence from "@/components/ScrollSequence/ScrollSequence";
import { FOYER_VIDEOS } from "@/lib/foyerVideos";
import { getFoyerAdminAllowed } from "@/server/auth/admin";

export const dynamic = "force-dynamic";
export default async function Home() {
  const foyerAdminAllowed = await getFoyerAdminAllowed();
  return (
    <>
      <Navbar foyerAdminAllowed={foyerAdminAllowed} />
      {/* The doors ride in the sequence's overlay — revealed, and made
          clickable, only once the scroll lands on the foyer. */}
      <ScrollSequence frameCount={193} scrollHeightVh={500} foyerVideos={FOYER_VIDEOS}>
        <RoomDoors />
      </ScrollSequence>
    </>
  );
}
