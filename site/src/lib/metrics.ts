import type { MetricDefinition, MetricId, PairMetrics } from "../types/data";

export const MODEL_DEPENDENCE_DIRECTION: Record<MetricId, "higher" | "lower"> = {
  adjusted_pog: "lower",
  high_loss_lift: "higher",
  adjusted_loss_corr: "higher",
  total_variation: "lower",
};

export function orientMetricToDependence(metric: MetricDefinition): MetricDefinition {
  return { ...metric, direction: MODEL_DEPENDENCE_DIRECTION[metric.id] };
}

export function dependenceDirectionLabel(metricId: MetricId): string {
  return MODEL_DEPENDENCE_DIRECTION[metricId] === "higher"
    ? "HIGHER → HIGHER DEPENDENCE"
    : "LOWER → HIGHER DEPENDENCE";
}

export function findPair(pairs: PairMetrics[], a: string, b: string): PairMetrics | undefined {
  return pairs.find((pair) => (pair.a === a && pair.b === b) || (pair.a === b && pair.b === a));
}

export function dependenceScore(value: number | null, metric: MetricDefinition, values: number[]): number {
  if (value === null || !Number.isFinite(value) || values.length === 0) return Number.NEGATIVE_INFINITY;
  const transform = metric.id === "high_loss_lift" ? (v: number) => Math.log1p(v) : (v: number) => v;
  const valid = values.filter((v) => Number.isFinite(v) && (metric.id !== "high_loss_lift" || v >= 0)).map(transform);
  if (!valid.length || (metric.id === "high_loss_lift" && value < 0)) return Number.NEGATIVE_INFINITY;
  const min = Math.min(...valid);
  const max = Math.max(...valid);
  if (max === min) return 0.5;
  const normalized = (transform(value) - min) / (max - min);
  return metric.direction === "higher" ? normalized : 1 - normalized;
}

export function diversityScore(value: number | null, metric: MetricDefinition, values: number[]): number {
  const dependence = dependenceScore(value, metric, values);
  return Number.isFinite(dependence) ? 1 - dependence : dependence;
}

export function sortPairs(pairs: PairMetrics[], metric: MetricDefinition): PairMetrics[] {
  return [...pairs].sort((left, right) => {
    const leftValue = left.metrics[metric.id].value;
    const rightValue = right.metrics[metric.id].value;
    const leftMissing = leftValue === null || !Number.isFinite(leftValue);
    const rightMissing = rightValue === null || !Number.isFinite(rightValue);
    if (leftMissing && rightMissing) return 0;
    if (leftMissing) return 1;
    if (rightMissing) return -1;
    return metric.direction === "higher" ? rightValue - leftValue : leftValue - rightValue;
  });
}

export function highLossDiagnosticLabel(pair: PairMetrics): string {
  const d = pair.diagnostics;
  if (d.high_loss_rate_a == null || d.high_loss_rate_b == null) return "High-loss marginal counts unavailable; total overlap does not establish reliability.";
  const a = Math.round(d.high_loss_rate_a * pair.n_overlap);
  const b = Math.round(d.high_loss_rate_b * pair.n_overlap);
  const joint = d.joint_high_loss_count ?? (d.joint_high_loss_rate == null ? "unavailable" : Math.round(d.joint_high_loss_rate * pair.n_overlap));
  return `Marginal high-loss counts: ${a} / ${b}; joint: ${joint}. ${Math.min(a, b) < 5 ? "Sparse marginal counts (<5); interpret lift cautiously." : "Counts refer to shared forecast targets, not necessarily independent events."}`;
}

export function formatMetric(value: number | null, metricId: MetricId): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return metricId === "high_loss_lift" ? value.toFixed(2) : value.toFixed(3);
}

export function colorForScore(score: number): string {
  const clamped = Math.max(0, Math.min(1, score));
  const stops = [
    { p: 0, rgb: [244, 239, 248] },
    { p: 0.5, rgb: [167, 129, 194] },
    { p: 1, rgb: [79, 32, 127] },
  ];
  const [start, end] = clamped <= 0.5 ? [stops[0], stops[1]] : [stops[1], stops[2]];
  const t = (clamped - start.p) / (end.p - start.p);
  const rgb = start.rgb.map((channel, index) => Math.round(channel + (end.rgb[index] - channel) * t));
  return `rgb(${rgb.join(", ")})`;
}

export function textColorForScore(score: number): string {
  return score >= 0.6 ? "#ffffff" : "#241d2b";
}
