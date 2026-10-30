import { redirect } from "next/navigation";
/** Old discovery URL: the guided journey's discovery step replaces it. */
export default async function OldDiscover({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  redirect(`/family/book/nannies${sp.q ? `?q=${encodeURIComponent(sp.q.slice(0, 80))}` : ""}`);
}
