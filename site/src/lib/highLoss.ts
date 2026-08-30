/** High-loss display and reporting policy. Never change the stored lift or loss. */
export interface HighLossDiagnostics {
  threshold?: number;
  n_targets?: number;
  high_count_a?: number;
  high_count_b?: number;
  joint_high_count?: number;
  expected_joint_count?: number;
  reason?: string;
  included_fold_count?: number;
  defined_fold_count?: number;
  undefined_fold_count?: number;
  valid_train_target_cells?: number;
  train_target_cells?: number;
  min_high_count_a?: number;
  min_high_count_b?: number;
  min_joint_high_count?: number;
  zero_joint_fold_count?: number;
  reason_counts?: Record<string, number>;
  count_diagnostics_available?: boolean;
  counts_are_repeated_training_exposures?: boolean;
  aggregation?: string;
}

export const isHighLossMetric = (metric: string) => metric === "high_loss_lift" || metric === "high_loss_diversity";

const signedLog = (value: number) => Math.sign(value) * Math.log1p(Math.abs(value));
const inverseSignedLog = (value: number) => Math.sign(value) * Math.expm1(Math.abs(value));

/** Nonlinear spacing ONLY: ticks, tooltips, exports and correlations remain raw. */
export function highLossAxis(values: number[], range: [number, number]) {
  const valid = values.filter(Number.isFinite);
  const domain: [number, number] = [Math.min(0, ...valid), Math.max(1, ...valid)];
  const low = signedLog(domain[0]);
  const high = signedLog(domain[1]);
  const ticks = Array.from({ length: 6 }, (_, index) => inverseSignedLog(low + (high - low) * index / 5));
  ticks[0] = domain[0];
  ticks[ticks.length - 1] = domain[1];
  // Mark independence explicitly, without adding an almost-identical tick.
  if (domain[0] < 0) {
    const nearby = ticks.findIndex((tick, index) => index > 0 && index < ticks.length - 1 && Math.abs(signedLog(tick)) / (high - low) < 0.06);
    if (nearby >= 0) ticks[nearby] = 0;
    else ticks.push(0);
  }
  ticks.sort((a, b) => a - b);
  return {
    domain,
    ticks,
    position: (raw: number) => Number.isFinite(raw)
      ? range[0] + (signedLog(raw) - low) / (high - low) * (range[1] - range[0])
      : Number.NaN,
  };
}

export function rawPearson(xs: number[], ys: number[]): number | null {
  if (xs.length !== ys.length || xs.length < 2 || !xs.every(Number.isFinite) || !ys.every(Number.isFinite)) return null;
  if (xs.every((x) => x === xs[0]) || ys.every((y) => y === ys[0])) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let xx = 0, yy = 0, xy = 0;
  xs.forEach((x, i) => { const dx = x - mx, dy = ys[i] - my; xx += dx * dx; yy += dy * dy; xy += dx * dy; });
  const r = xy / Math.sqrt(xx * yy);
  return Number.isFinite(r) ? Math.max(-1, Math.min(1, r)) : null;
}

function ranks(values: number[]) {
  const sorted = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const result = Array<number>(values.length);
  let i = 0;
  while (i < sorted.length) {
    let j = i + 1;
    while (j < sorted.length && sorted[j].value === sorted[i].value) j++;
    for (let k = i; k < j; k++) result[sorted[k].index] = (i + j - 1) / 2 + 1;
    i = j;
  }
  return result;
}

export function rawSpearman(xs: number[], ys: number[]): number | null {
  if (!xs.every(Number.isFinite) || !ys.every(Number.isFinite)) return null;
  return rawPearson(ranks(xs), ranks(ys));
}

/** A reporting guard, not a significance test or a change to point eligibility. */
export function highLossAssociationReason(xs: number[], ys: number[], retainedDirections?: number[], maximumDirections?: number): string | null {
  if (xs.length !== ys.length || !xs.every(Number.isFinite) || !ys.every(Number.isFinite)) return "Association unavailable: coordinates contain missing or invalid values.";
  if (xs.length < 3) return "Association not reported: fewer than three displayed pairs.";
  const unique = new Set(xs).size;
  if (unique < 3) return `Association not reported: only ${unique} distinct high-loss values; a single outlying group can determine the coefficient.`;
  if (ys.every((y) => y === ys[0])) return "Association unavailable: every displayed outcome is identical.";
  if (maximumDirections && retainedDirections?.some((count) => count < maximumDirections / 2)) {
    return "Association not reported: at least one pair retains fewer than half of the attempted directions. Points remain visible; this is a reporting guard, not a significance test.";
  }
  return null;
}

export function highLossSparseCount(diagnostics: HighLossDiagnostics[]): number {
  return diagnostics.filter((d) => {
    const a = d.min_high_count_a ?? d.high_count_a;
    const b = d.min_high_count_b ?? d.high_count_b;
    return (a !== undefined && a < 5) || (b !== undefined && b < 5);
  }).length;
}
