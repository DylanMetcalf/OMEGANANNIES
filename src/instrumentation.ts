export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
  const { configProblems } = await import("./lib/config-check");
  const { fatal, warnings } = configProblems();
  for (const w of warnings) console.warn(`[config] ${w}`);
  if (fatal.length) { for (const f of fatal) console.error(`[config] ${f}`); throw new Error("Unsafe configuration — refusing to start. See messages above."); }
}
