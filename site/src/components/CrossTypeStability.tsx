import { useEffect, useMemo, useState } from "react";
import { colorForScore, textColorForScore } from "../lib/metrics";
import { crossTypeAssetUrl } from "../lib/data";
import type { CrossTypeCell, CrossTypeData, CrossTypeMetricId } from "../types/data";

interface CrossTypeStabilityProps {
  data: CrossTypeData | null;
  loading: boolean;
  error: string;
}

interface SelectedCell {
  cell: CrossTypeCell;
  rowTopic: string;
  columnTopic: string;
}

const pairKey = (left: string, right: string) => [left, right].sort().join("::");
const cellKey = (left: string, right: string, metric: string, sample: string) =>
  `${pairKey(left, right)}::${metric}::${sample}`;

function formatCoefficient(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "—" : value.toFixed(3);
}

function formatRate(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "—" : `${(value * 100).toFixed(1)}%`;
}

function statusLabel(status: CrossTypeCell["interpretation_status"]): string {
  if (status === "headline") return "Headline coverage";
  if (status === "limited") return "Limited sample";
  return "Insufficient sample";
}

export function CrossTypeStability({ data, loading, error }: CrossTypeStabilityProps) {
  const [metricId, setMetricId] = useState<CrossTypeMetricId>("adjusted_pog");
  const [sampleId, setSampleId] = useState("");
  const [selected, setSelected] = useState<SelectedCell | null>(null);

  useEffect(() => {
    if (!data) return;
    const nextMetric = data.manifest.metrics.find((metric) => metric.id === metricId)?.id
      ?? data.manifest.metrics[0]?.id;
    const nextSample = data.manifest.samples.find((sample) => sample.id === sampleId)?.id
      ?? data.manifest.samples.find((sample) => sample.primary)?.id
      ?? data.manifest.samples[0]?.id;
    if (nextMetric && nextMetric !== metricId) setMetricId(nextMetric);
    if (nextSample && nextSample !== sampleId) setSampleId(nextSample);
  }, [data, metricId, sampleId]);

  useEffect(() => {
    setSelected(null);
  }, [metricId, sampleId]);

  const cells = useMemo(() => {
    const indexed = new Map<string, CrossTypeCell>();
    for (const cell of data?.summary.cells ?? []) {
      indexed.set(cellKey(cell.topic_a, cell.topic_b, cell.metric_id, cell.sample_id), cell);
    }
    return indexed;
  }, [data]);

  if (loading) {
    return (
      <section className="cross-type-section" id="stability" aria-busy="true">
        <div className="section-heading"><div><p className="eyebrow">CROSS-EVENT-TYPE STABILITY</p><h2>Loading stability analysis…</h2></div></div>
      </section>
    );
  }

  if (!data) {
    return (
      <section className="cross-type-section" id="stability">
        <div className="section-heading">
          <div><p className="eyebrow">CROSS-EVENT-TYPE STABILITY</p><h2>Descriptive pair stability across event types</h2></div>
          <p>Describes whether the same model pairs remain dependent or complementary across the seven semantic event types.</p>
        </div>
        <div className="cross-type-unavailable" role="status">
          <strong>{error ? "Cross-type data could not be loaded" : "Cross-type dataset not published yet"}</strong>
          <span>{error || "This section will activate when the audited cross-type release is available. No placeholder values are shown."}</span>
        </div>
      </section>
    );
  }

  const topics = data.manifest.topics;
  const metric = data.manifest.metrics.find((item) => item.id === metricId) ?? data.manifest.metrics[0];
  const sample = data.manifest.samples.find((item) => item.id === sampleId)
    ?? data.manifest.samples.find((item) => item.primary)
    ?? data.manifest.samples[0];
  const selectedMetricId = metric?.id ?? metricId;
  const selectedSampleId = sample?.id ?? sampleId;
  const topicLabels = new Map(topics.map((topic) => [topic.id, topic.label_en]));
  const selectedIsForward = selected ? selected.rowTopic === selected.cell.topic_a : true;

  const directionValue = (
    forward: keyof Pick<CrossTypeCell,
      "dependency_persistence_a_to_b" | "complementarity_persistence_a_to_b" | "dependency_to_complementarity_a_to_b">,
    reverse: keyof Pick<CrossTypeCell,
      "dependency_persistence_b_to_a" | "complementarity_persistence_b_to_a" | "dependency_to_complementarity_b_to_a">,
  ) => selected ? selected.cell[selectedIsForward ? forward : reverse] : null;

  const reverseDirectionValue = (
    forward: keyof Pick<CrossTypeCell,
      "dependency_persistence_a_to_b" | "complementarity_persistence_a_to_b" | "dependency_to_complementarity_a_to_b">,
    reverse: keyof Pick<CrossTypeCell,
      "dependency_persistence_b_to_a" | "complementarity_persistence_b_to_a" | "dependency_to_complementarity_b_to_a">,
  ) => selected ? selected.cell[selectedIsForward ? reverse : forward] : null;

  return (
    <section className="cross-type-section" id="stability" data-testid="cross-type-stability">
      <div className="section-heading">
        <div><p className="eyebrow">CROSS-EVENT-TYPE STABILITY</p><h2>Descriptive pair stability across event types</h2></div>
        <p>Each cell compares the ranking of the same exact model pairs in two topic slices. Color encodes Spearman rank stability; insufficient cells are never colored or interpreted.</p>
      </div>

      <div className="cross-type-toolbar">
        <div className="cross-type-tabs" role="tablist" aria-label="Cross-type metric">
          {data.manifest.metrics.map((item) => (
            <button key={item.id} role="tab" aria-selected={item.id === selectedMetricId} className={item.id === selectedMetricId ? "active" : ""} onClick={() => setMetricId(item.id)}>{item.label}</button>
          ))}
        </div>
        <div className="sample-toggle" role="group" aria-label="Cross-type sample">
          {data.manifest.samples.map((item) => (
            <button key={item.id} aria-pressed={item.id === selectedSampleId} className={item.id === selectedSampleId ? "active" : ""} onClick={() => setSampleId(item.id)}>{item.label}</button>
          ))}
        </div>
        <div className="cross-type-downloads">
          <a href={crossTypeAssetUrl(data.manifest.summary_csv)} download>Summary CSV ↓</a>
          <a href={crossTypeAssetUrl(data.manifest.pair_details_gzip)} download>Full pair detail ↓</a>
        </div>
      </div>

      <div className="cross-type-layout">
        <div>
          <div className="cross-type-legend"><span>Rank reversal</span><i /><span>Stable ordering</span><small>Spearman −1 to +1</small></div>
          <div className="cross-type-scroll">
            <div className="cross-type-grid" style={{ gridTemplateColumns: `minmax(116px, 1.25fr) repeat(${topics.length}, minmax(70px, 1fr))` }}>
              <div className="cross-type-corner">EVENT TYPE</div>
              {topics.map((topic) => <div className="cross-type-column" key={`column-${topic.id}`}><span>{topic.label_en}</span></div>)}
              {topics.map((rowTopic) => (
                <div key={`row-${rowTopic.id}`} className="cross-type-row" style={{ display: "contents" }}>
                  <div className="cross-type-row-label">{rowTopic.label_en}</div>
                  {topics.map((columnTopic) => {
                    if (rowTopic.id === columnTopic.id) {
                      return <div className="cross-type-cell diagonal" key={`${rowTopic.id}-${columnTopic.id}`} aria-label={`${rowTopic.label_en} diagonal: 1.000`}>1.000</div>;
                    }
                    const cell = cells.get(cellKey(rowTopic.id, columnTopic.id, selectedMetricId, selectedSampleId));
                    if (!cell) {
                      return <div className="cross-type-cell missing" key={`${rowTopic.id}-${columnTopic.id}`} aria-label={`${rowTopic.label_en} and ${columnTopic.label_en}: missing`}>—</div>;
                    }
                    const insufficient = cell.interpretation_status === "insufficient" || cell.spearman === null;
                    const score = cell.spearman === null ? 0.5 : (cell.spearman + 1) / 2;
                    const active = selected?.cell === cell;
                    return (
                      <button
                        type="button"
                        key={`${rowTopic.id}-${columnTopic.id}`}
                        className={`cross-type-cell ${cell.interpretation_status} ${active ? "active" : ""}`}
                        style={insufficient ? undefined : { background: colorForScore(score), color: textColorForScore(score) }}
                        aria-label={`${rowTopic.label_en} and ${columnTopic.label_en}: ${insufficient ? "insufficient sample" : `Spearman ${formatCoefficient(cell.spearman)}`}`}
                        onClick={() => setSelected({ cell, rowTopic: rowTopic.id, columnTopic: columnTopic.id })}
                      >
                        <strong>{insufficient ? "—" : formatCoefficient(cell.spearman)}</strong>
                        <small>{cell.interpretation_status === "limited" ? "LIMITED" : `n=${cell.n_defined_pairs}`}</small>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>

        {selected && <aside className="cross-type-inspector" data-testid="cross-type-inspector">
          <>
            <header>
              <p className="eyebrow">CELL DETAIL</p>
              <h3>{topicLabels.get(selected.rowTopic)} <span>×</span> {topicLabels.get(selected.columnTopic)}</h3>
              <div className={`interpretation-badge ${selected.cell.interpretation_status}`}>{statusLabel(selected.cell.interpretation_status)}</div>
            </header>
            <div className="stability-readout">
              <div><span>Spearman</span><strong>{formatCoefficient(selected.cell.spearman)}</strong></div>
              <div><span>Pearson</span><strong>{formatCoefficient(selected.cell.pearson)}</strong></div>
              <div><span>Dependent top/top</span><strong>{formatCoefficient(selected.cell.dependent_top_jaccard)}</strong></div>
              <div><span>Complementary top/top</span><strong>{formatCoefficient(selected.cell.complementary_top_jaccard)}</strong></div>
            </div>
            <dl className="cross-type-coverage">
              <div><dt>Common defined pairs</dt><dd>{selected.cell.n_defined_pairs.toLocaleString()}</dd></div>
              <div><dt>Pairs in sample</dt><dd>{selected.cell.n_sample_pairs.toLocaleString()}</dd></div>
              <div><dt>Exact pair universe</dt><dd>{selected.cell.n_pair_universe.toLocaleString()}</dd></div>
            </dl>
            {selected.cell.interpretation_status === "insufficient" ? (
              <div className="interpretation-note insufficient"><strong>Not interpreted</strong><span>{selected.cell.reason ?? `Fewer than ${data.manifest.thresholds.reporting_min_defined_pairs} common defined pairs.`}</span></div>
            ) : <>
              {selected.cell.interpretation_status === "limited" && <div className="interpretation-note limited"><strong>Limited evidence</strong><span>Below the {data.manifest.thresholds.headline_min_defined_pairs}-pair headline threshold. Treat directional rates as exploratory.</span></div>}
              <div className="direction-table">
                <div className="direction-head"><span>Directional statistic</span><b>{topicLabels.get(selected.rowTopic)} → {topicLabels.get(selected.columnTopic)}</b><b>{topicLabels.get(selected.columnTopic)} → {topicLabels.get(selected.rowTopic)}</b></div>
                <div><span>Dependency persistence</span><strong>{formatRate(directionValue("dependency_persistence_a_to_b", "dependency_persistence_b_to_a"))}</strong><strong>{formatRate(reverseDirectionValue("dependency_persistence_a_to_b", "dependency_persistence_b_to_a"))}</strong></div>
                <div><span>Complementarity persistence</span><strong>{formatRate(directionValue("complementarity_persistence_a_to_b", "complementarity_persistence_b_to_a"))}</strong><strong>{formatRate(reverseDirectionValue("complementarity_persistence_a_to_b", "complementarity_persistence_b_to_a"))}</strong></div>
                <div><span>Dependency → complementarity flip</span><strong>{formatRate(directionValue("dependency_to_complementarity_a_to_b", "dependency_to_complementarity_b_to_a"))}</strong><strong>{formatRate(reverseDirectionValue("dependency_to_complementarity_a_to_b", "dependency_to_complementarity_b_to_a"))}</strong></div>
              </div>
            </>}
          </>
        </aside>}
      </div>
      <p className="cross-type-footnote">Top/top and directional statistics use the manifest quartile ({Math.round(data.manifest.thresholds.quartile * 100)}%). Headline cells require at least {data.manifest.thresholds.headline_min_defined_pairs} common defined model pairs; reporting begins at {data.manifest.thresholds.reporting_min_defined_pairs}.</p>
    </section>
  );
}
