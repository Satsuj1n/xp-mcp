/**
 * Round to 2 decimals (BRL precision). Math is done in cents elsewhere; this
 * is used only at output boundaries to avoid IEEE 754 noise like
 * `13.130000000000001`.
 */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
