/** Money is always integer minor units (cents) with an explicit currency. No floating point. */
export type Money = { amount: number; currency: string };

export function assertMinor(n: number): number {
  if (!Number.isSafeInteger(n)) throw new Error(`Money must be an integer number of minor units, got ${n}`);
  return n;
}
/** Apply basis points (1% = 100 bps) with banker-safe half-up rounding on integers. */
export function applyBps(minor: number, bps: number): number {
  assertMinor(minor); assertMinor(bps);
  const product = BigInt(minor) * BigInt(bps);
  const q = product / 10000n, r = product % 10000n;
  return Number(r * 2n >= 10000n ? q + 1n : q);
}
export function mulQty(unitMinor: number, qtyHundredths: number): number {
  // qty expressed in hundredths (e.g. 4.5 hours = 450) to stay integer
  const product = BigInt(assertMinor(unitMinor)) * BigInt(assertMinor(qtyHundredths));
  const q = product / 100n, r = product % 100n;
  return Number(r * 2n >= 100n ? q + 1n : q);
}
export function formatMoney(minor: number, currency = "ZAR"): string {
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const cents = abs % 100;
  const sym = currency === "ZAR" ? "R" : currency + " ";
  return `${sign}${sym}${whole}${cents ? "." + String(cents).padStart(2, "0") : ""}`;
}
/** Parse a user-entered rand amount ("1 250.50", "R300") into minor units without floats. */
export function parseMoney(input: string): number {
  const s = input.replace(/[R\s,]/gi, "");
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) throw new Error(`Invalid amount: ${input}`);
  const minor = Number(m[2]) * 100 + Number((m[3] ?? "").padEnd(2, "0"));
  return m[1] ? -minor : minor;
}
