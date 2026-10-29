import { RoleShell } from "@/components/role-shell";
import { requireUser } from "@/lib/auth";
export default async function L({ children }: { children: React.ReactNode }) {
  return <RoleShell user={await requireUser()}>{children}</RoleShell>;
}
