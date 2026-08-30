import { highLossSparseCount, isHighLossMetric, type HighLossDiagnostics } from "../lib/highLoss";

interface Props {
  metric: string;
  values: number[];
  missingCount?: number;
  totalCount?: number;
  retainedDirections?: number[];
  maximumDirections?: number;
  associationReason?: string | null;
  diagnostics?: HighLossDiagnostics[];
}

export function HighLossNotice({ metric, values, missingCount = 0, totalCount, retainedDirections, maximumDirections, associationReason, diagnostics = [] }: Props) {
  if (!isHighLossMetric(metric)) return null;
  const zeroJoint = values.filter((value) => value === 1).length;
  const sparse = highLossSparseCount(diagnostics);
  const countsAvailable = diagnostics.some((d) => (d.high_count_a !== undefined && d.high_count_b !== undefined)
    || (d.min_high_count_a !== undefined && d.min_high_count_b !== undefined));
  const lowDirections = maximumDirections ? retainedDirections?.filter((n) => n < maximumDirections / 2).length ?? 0 : 0;
  return <div className="high-loss-notice" role="note" aria-label="High-loss metric diagnostics">
    <p><strong>High-loss diversity: signed-log spacing.</strong> Tick labels and values are raw 1 − lift; no values are clipped.
      {missingCount > 0 && <> <strong>{missingCount}{totalCount === undefined ? "" : ` / ${totalCount}`} candidates have an undefined high-loss coordinate and are not plotted.</strong></>}
      {lowDirections > 0 && <> {lowDirections} plotted pairs retain fewer than half of the attempted directions.</>}
      {sparse > 0 && <> {sparse} candidate pairs have fewer than 5 high-loss records on at least one side in an included sample.</>}
    </p>
    {associationReason && <p className="high-loss-association-warning">{associationReason}</p>}
    <details><summary>How to interpret this metric</summary>
      <p>High loss means adjusted Brier loss &gt; 0.25. Lift divides the observed joint high-loss rate by the product of the two marginal rates. Diversity = 0 corresponds to lift = 1 (the independence reference); negative values mean more shared high losses than that reference. Diversity cannot exceed 1, but has no fixed lower bound.</p>
      <p>A value of 1 means no joint high losses were observed while both marginal counts were positive—not perfect complementarity. {zeroJoint > 0 && <>{zeroJoint} displayed points have this value. </>}If either marginal count is zero, lift is undefined, never replaced by zero or one. A cross-fit mean is also undefined when any included direction is undefined; its outcome is not paired with a partial-direction coordinate.</p>
      <p>Very few high-loss records can produce extreme lift even with many total predictions. Five records is a descriptive warning threshold, not proof of reliability. Repeated split counts reuse events and are not independent observations. Train Near-BI does not guarantee test Near-BI. {!countsAvailable && <>Marginal high-loss counts are not published for this view; total overlap alone does not establish reliability.</>}</p>
      <p>Nonlinear spacing changes only the picture. Any reported correlation uses raw coordinates, remains descriptive, and is not a significance test.</p>
    </details>
  </div>;
}

export function HighLossRawNotice({ metric, colorScale = false }: { metric: string; colorScale?: boolean }) {
  if (!isHighLossMetric(metric)) return null;
  return <div className="high-loss-notice" role="note" aria-label="Raw high-loss lift interpretation">
    <p><strong>Raw high-loss lift.</strong> 1 is the independence reference; 0 means no observed joint high losses with positive marginals. Lift has no fixed upper bound. {colorScale && <>Colors use log(1 + lift) spacing; cell values and ranking remain raw.</>}</p>
    <details><summary>Reliability and missing values</summary><p>High loss means adjusted Brier loss &gt; 0.25. Tiny marginal counts can produce very large lift. A zero marginal makes lift undefined, not zero. Overlap alone does not establish reliability; inspect the high-loss counts where available. The independence reference is not a statistical independence test.</p></details>
  </div>;
}
