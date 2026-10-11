/** The smallest 1, 2 or 5 × 10ᵏ that is ≥ `raw`. */
export function niceStep(raw: number): number {
  const exp = Math.floor(Math.log10(raw));
  const base = 10 ** exp;
  for (const m of [1, 2, 5]) if (m * base >= raw * (1 - 1e-12)) return m * base;
  return 10 * base;
}

/** Major grid lines at least `targetPx` apart (so 60–150 px); minor lines split them in 5 (in 4 when the major step is 2·10ᵏ). */
export function gridSpacing(scale: number, targetPx = 60): { major: number; minor: number } {
  const major = niceStep(targetPx / scale);
  const mantissa = Math.round(major / 10 ** Math.floor(Math.log10(major)));
  return { major, minor: major / (mantissa === 2 ? 4 : 5) };
}

/** Multiples of `step` in [lo, hi], none when there would be more than `max`. */
export function ticks(lo: number, hi: number, step: number, max = 2000): number[] {
  const first = Math.ceil(lo / step);
  const last = Math.floor(hi / step);
  if (!(last - first < max)) return [];
  const out: number[] = [];
  for (let i = first; i <= last; i++) out.push(i * step);
  return out;
}

/** A tick label: as many decimals as the step needs, exponent notation for very large or small steps. */
export function formatTick(v: number, step: number): string {
  if (Math.abs(v) < step * 1e-9) return "0";
  if (step >= 1e6 || step < 1e-4) return Number(v.toPrecision(12)).toExponential().replace("e+", "e");
  return v.toFixed(Math.max(0, Math.ceil(-Math.log10(step) - 1e-9)));
}
