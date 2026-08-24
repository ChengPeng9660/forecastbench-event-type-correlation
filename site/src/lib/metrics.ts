import type { MetricDefinition, MetricId, PairMetrics } from "../types/data";

export const MODEL_DEPENDENCE_DIRECTION: Record<MetricId, "higher" | "lower"> = {
  adjusted_pog: "lower",
  high_loss_lift: "higher",
  adjusted_loss_corr: "higher",
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
  if (value === null || values.length === 0) return Number.NEGATIVE_INFINITY;
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return 0.5;
  const normalized = (value - min) / (max - min);
  return metric.direction === "higher" ? normalized : 1 - normalized;
}

export function sortPairs(pairs: PairMetrics[], metric: MetricDefinition): PairMetrics[] {
  return [...pairs].sort((left, right) => {
    const leftValue = left.metrics[metric.id].value;
    const rightValue = right.metrics[metric.id].value;
    if (leftValue === null) return 1;
    if (rightValue === null) return -1;
    return metric.direction === "higher" ? rightValue - leftValue : leftValue - rightValue;
  });
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
