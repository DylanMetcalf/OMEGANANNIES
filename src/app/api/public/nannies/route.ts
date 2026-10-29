import { searchNannies } from "@/lib/nannies";
/** Approved, published profiles for the public website (portal is the system of record for nanny profiles). */
export async function GET() {
  const list = await searchNannies({ sort: "name" });
  return Response.json(list.map(({ id, isDemo, ...rest }) => ({ ...rest, ref: id.slice(0, 8), demo: isDemo })), { headers: { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=3600" } });
}
