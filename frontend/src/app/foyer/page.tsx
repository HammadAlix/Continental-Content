import Navbar from "@/components/Navbar/Navbar";
import LegacyFoyer from "@/components/RoomDoors/LegacyFoyer";
import { getFoyerAdminAllowed } from "@/server/auth/admin";

export const dynamic = "force-dynamic";
export default async function FoyerPage() {
  const foyerAdminAllowed = await getFoyerAdminAllowed();
  return (
    <div style={{ position: "relative" }}>
      <Navbar foyerAdminAllowed={foyerAdminAllowed} />
      <LegacyFoyer />
    </div>
  );
}
