import { redirect } from "next/navigation";
import { getAdmin } from "@/server/auth/admin";

export const dynamic = "force-dynamic";
export default async function LegacyAdminPage() {
  if (!await getAdmin()) redirect("/account");
  redirect("/admin/store");
}
