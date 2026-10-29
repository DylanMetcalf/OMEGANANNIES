import { PageHeader } from "@/components/ui";
import { SettingsBody } from "@/components/settings";
import { requireUser } from "@/lib/auth";

export const metadata = { title: "Settings" };
export default async function Settings() {
  const u = await requireUser({ role: "family" });
  return <><PageHeader eyebrow="Settings" title="Account settings" /><SettingsBody userId={u.id} /></>;
}
