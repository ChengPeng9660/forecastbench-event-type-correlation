import { useEffect, useMemo, useState } from "react";
import { globalBaselineAssetUrl, loadGlobalPartnerProfiles } from "../lib/data";
import { colorForScore, textColorForScore } from "../lib/metrics";
import type {
  GlobalAbilityStabilityRow,
  GlobalBaselineData,
  GlobalBaselineComparisonModeId,
  GlobalBaselineInterpretationStatus,
  GlobalBaselineSampleId,
  GlobalBaselineScopeId,
  GlobalPairStabilityRow,
  GlobalPartnerProfileRow,
  GlobalPartnerSummaryRow,
  MetricId,
  Model,
} from "../types/data";

interface GlobalBaselineProps {
  data: GlobalBaselineData | null;
  models: Model[];
  loading: boolean;
  error: string;
}

interface Selection {
  scope: GlobalBaselineScopeId;
  metric: MetricId;
  sample: GlobalBaselineSampleId;
  comparison: GlobalBaselineComparisonModeId;
  topic: string;
  model: string;
}

const params = new URLSearchParams(window.location.search);
const querySelection = {
  scope: params.get("global_scope"),
  metric: params.get("global_metric"),
  sample: params.get("global_sample"),
  comparison: params.get("global_comparison"),
  topic: params.get("global_topic"),
  model: params.get("global_model"),
};

function finite(value: number | null | undefined): value is number {
  return value !== null && value !== undefined && Number.isFinite(value);
}

function coefficient(value: number | null | undefined): string {
  return finite(value) ? value.toFixed(3) : "—";
}

function metricValue(value: number | null | undefined, metric: MetricId): string {
  if (!finite(value)) return "—";
  return metric === "high_loss_lift" ? value.toFixed(2) : value.toFixed(3);
}

function percent(value: number | null | undefined): string {
  return finite(value) ? `${(value * 100).toFixed(1)}%` : "—";
}

function statusText(status: GlobalBaselineInterpretationStatus): string {
  if (status === "headline") return "Headline coverage";
  if (status === "limited") return "Limited evidence";
  return "Insufficient evidence";
}

function evidenceCoefficient(value: number | null | undefined, status: GlobalBaselineInterpretationStatus | undefined): string {
  return status === "insufficient" ? "—" : coefficient(value);
}

function evidencePercent(value: number | null | undefined, status: GlobalBaselineInterpretationStatus | undefined): string {
  return status === "insufficient" ? "—" : percent(value);
}

function setQueryValue(key: string, value: string) {
  const next = new URLSearchParams(window.location.search);
  if (value) next.set(key, value);
  else next.delete(key);
  window.history.replaceState(null, "", `${window.location.pathname}?${next.toString()}${window.location.hash}`);
}

function matchesScopeMetricSample(
  row: { global_scope: string; metric_id: string; sample_id: string },
  selection: Selection,
) {
  return row.global_scope === selection.scope
    && row.metric_id === selection.metric
    && row.sample_id === selection.sample;
}

function matches(
  row: { global_scope: string; metric_id: string; sample_id: string; comparison_mode: string },
  selection: Selection,
) {
  return matchesScopeMetricSample(row, selection) && row.comparison_mode === selection.comparison;
}

function RankTrack({ value, status }: { value: number | null | undefined; status: GlobalBaselineInterpretationStatus | undefined }) {
  if (!finite(value) || status === "insufficient") {
    return <div className="global-rank-track unavailable"><span>Not reported</span></div>;
  }
  const score = (value + 1) / 2;
  return (
    <div className="global-rank-track" aria-hidden="true">
      <i className="global-rank-axis" />
      <i className="global-rank-zero" />
      <b style={{ left: `${score * 100}%`, background: colorForScore(score) }} />
    </div>
  );
}

function TopicDetail({
  pair,
  partner,
  ability,
  topicLabel,
}: {
  pair: GlobalPairStabilityRow;
  partner: GlobalPartnerSummaryRow | undefined;
  ability: GlobalAbilityStabilityRow | undefined;
  topicLabel: string;
}) {
  const isInsufficient = pair.interpretation_status === "insufficient";
  return (
    <div className="global-topic-detail" data-testid="global-topic-detail">
      <header>
        <div><p className="eyebrow">TOPIC DETAIL</p><h3>Global <span>→</span> {topicLabel}</h3></div>
        <div className={`interpretation-badge ${pair.interpretation_status}`}>{statusText(pair.interpretation_status)}</div>
      </header>
      <div className="global-detail-columns">
        <div>
          <h4>Pair ordering</h4>
          <dl className="global-stat-grid">
            <div><dt>Spearman</dt><dd>{coefficient(pair.spearman)}</dd></div>
            <div><dt>Pearson</dt><dd>{coefficient(pair.pearson)}</dd></div>
            <div><dt>Defined pairs</dt><dd>{pair.n_defined_pairs.toLocaleString()}</dd></div>
            <div><dt>Sample pairs</dt><dd>{pair.n_sample_pairs.toLocaleString()}</dd></div>
          </dl>
        </div>
        <div>
          <h4>Quartile agreement</h4>
          <dl className="global-stat-grid">
            <div><dt>Dependent Jaccard</dt><dd>{coefficient(pair.dependent_top_jaccard)}</dd></div>
            <div><dt>Complementary Jaccard</dt><dd>{coefficient(pair.complementary_top_jaccard)}</dd></div>
            <div><dt>Dependency retained</dt><dd>{percent(pair.dependency_persistence_global_to_topic)}</dd></div>
            <div><dt>Complementarity retained</dt><dd>{percent(pair.complementarity_persistence_global_to_topic)}</dd></div>
          </dl>
        </div>
        <div>
          <h4>Model-level controls</h4>
          <dl className="global-stat-grid">
            <div><dt>Median partner ρ</dt><dd>{evidenceCoefficient(partner?.median_spearman, partner?.interpretation_status)}</dd></div>
            <div><dt>Negative focal models</dt><dd>{evidencePercent(partner?.fraction_negative_spearman, partner?.interpretation_status)}</dd></div>
            <div><dt>Individual BI ρ</dt><dd>{evidenceCoefficient(ability?.spearman, ability?.interpretation_status)}</dd></div>
            <div><dt>BI top-quartile Jaccard</dt><dd>{evidenceCoefficient(ability?.top_quartile_jaccard, ability?.interpretation_status)}</dd></div>
          </dl>
        </div>
      </div>
      {isInsufficient && <p className="global-detail-note">{pair.reason ?? "This comparison does not meet the reporting threshold, so coefficients remain suppressed."}</p>}
      {!isInsufficient && (
        <p className="global-detail-note">Global dependency → topic complementarity flip: <strong>{percent(pair.dependency_to_complementarity_global_to_topic)}</strong>. Reverse-direction flip: <strong>{percent(pair.dependency_to_complementarity_topic_to_global)}</strong>.</p>
      )}
    </div>
  );
}

export function GlobalBaseline({ data, models, loading, error }: GlobalBaselineProps) {
  const [selection, setSelection] = useState<Selection>({
    scope: "official_full",
    metric: "adjusted_pog",
    sample: "near_bi_both",
    comparison: "leave_topic_out",
    topic: "",
    model: "",
  });
  const [profiles, setProfiles] = useState<GlobalPartnerProfileRow[] | null>(null);
  const [profilesModelId, setProfilesModelId] = useState("");
  const [profilesError, setProfilesError] = useState("");
  const [profilesLoading, setProfilesLoading] = useState(false);
  const [modelQuery, setModelQuery] = useState("");

  useEffect(() => {
    if (!data) return;
    const scope = data.manifest.global_scopes.find((item) => item.id === querySelection.scope)?.id
      ?? data.manifest.global_scopes[0]?.id;
    const metric = data.manifest.metrics.find((item) => item.id === querySelection.metric)?.id
      ?? data.manifest.metrics[0]?.id;
    const sample = data.manifest.samples.find((item) => item.id === querySelection.sample)?.id
      ?? data.manifest.samples.find((item) => item.primary)?.id
      ?? data.manifest.samples[0]?.id;
    const topic = data.manifest.topics.some((item) => item.id === querySelection.topic) ? querySelection.topic ?? "" : "";
    const comparison = data.manifest.comparison_modes.find((item) => item.id === querySelection.comparison)?.id
      ?? data.manifest.comparison_modes.find((item) => item.primary)?.id
      ?? data.manifest.comparison_modes[0]?.id;
    setSelection((current) => ({
      scope: scope ?? current.scope,
      metric: metric ?? current.metric,
      sample: sample ?? current.sample,
      comparison: comparison ?? current.comparison,
      topic,
      model: querySelection.model ?? "",
    }));
  }, [data]);

  useEffect(() => {
    if (!data || !selection.model || profilesModelId === selection.model) return;
    const profilePath = data.manifest.partner_profile_files[selection.model];
    if (!profilePath) {
      setProfiles(null);
      setProfilesModelId(selection.model);
      setProfilesError("This model is not part of the audited clean-model universe.");
      return;
    }
    let active = true;
    setProfiles(null);
    setProfilesError("");
    setProfilesLoading(true);
    loadGlobalPartnerProfiles(profilePath, data.manifest.schema_version, selection.model)
      .then((rows) => { if (active) { setProfiles(rows); setProfilesModelId(selection.model); } })
      .catch((reason: Error) => { if (active) { setProfilesError(reason.message); setProfilesModelId(selection.model); } })
      .finally(() => { if (active) setProfilesLoading(false); });
    return () => { active = false; };
  }, [data, profilesModelId, selection.model]);

  useEffect(() => {
    if (!selection.model) return;
    const selectedModel = models.find((model) => model.id === selection.model);
    if (selectedModel) setModelQuery(selectedModel.name);
  }, [models, selection.model]);

  const topicLabels = useMemo(() => new Map(data?.manifest.topics.map((topic) => [topic.id, topic.label_en]) ?? []), [data]);
  const pairRows = useMemo(() => (data?.summary.pair_stability ?? []).filter((row) => matches(row, selection)), [data, selection]);
  const partnerRows = useMemo(() => (data?.summary.partner_summary ?? []).filter((row) => matches(row, selection)), [data, selection]);
  const abilityRows = useMemo(() => (data?.summary.ability_stability ?? []).filter((row) => row.global_scope === selection.scope && row.comparison_mode === selection.comparison), [data, selection.comparison, selection.scope]);
  const profileRows = useMemo(() => (profiles ?? [])
    .filter((row) => matches(row, selection) && row.focal_model_id === selection.model)
    .sort((left, right) => (data?.manifest.topics.findIndex((topic) => topic.id === left.topic_id) ?? 0) - (data?.manifest.topics.findIndex((topic) => topic.id === right.topic_id) ?? 0)), [data, profiles, selection]);

  if (loading) {
    return <section className="global-baseline-section" id="global" aria-busy="true"><div className="section-heading"><div><p className="eyebrow">GLOBAL BASELINE</p><h2>Loading global analysis…</h2></div></div></section>;
  }

  if (!data) {
    return (
      <section className="global-baseline-section" id="global">
        <div className="section-heading">
          <div><p className="eyebrow">GLOBAL BASELINE</p><h2>Global dependence and rank stability</h2></div>
          <p>Establishes the no-topic baseline, then tests whether pair, partner, and individual-model rankings survive topic conditioning.</p>
        </div>
        <div className="cross-type-unavailable" role="status"><strong>{error ? "Global-baseline data could not be loaded" : "Global-baseline dataset not published yet"}</strong><span>{error || "This section activates only when the audited release is available. No placeholder values are shown."}</span></div>
      </section>
    );
  }

  const scope = data.manifest.global_scopes.find((item) => item.id === selection.scope) ?? data.manifest.global_scopes[0];
  const metric = data.manifest.metrics.find((item) => item.id === selection.metric) ?? data.manifest.metrics[0];
  const sample = data.manifest.samples.find((item) => item.id === selection.sample) ?? data.manifest.samples[0];
  const globalSummary = data.summary.global_pair_summary.find((row) => matchesScopeMetricSample(row, selection));
  const selectedPair = pairRows.find((row) => row.topic_id === selection.topic);
  const selectedPartner = partnerRows.find((row) => row.topic_id === selection.topic);
  const selectedAbility = abilityRows.find((row) => row.topic_id === selection.topic);
  const cleanModels = models.filter((model) => data.manifest.partner_profile_files[model.id]);

  function update<K extends keyof Selection>(key: K, value: Selection[K]) {
    setSelection((current) => ({ ...current, [key]: value, ...(key === "scope" || key === "metric" || key === "sample" || key === "comparison" ? { topic: "" } : {}) }));
    setQueryValue(`global_${key}`, String(value));
    if (key === "scope" || key === "metric" || key === "sample" || key === "comparison") setQueryValue("global_topic", "");
  }

  function chooseModel(modelId: string) {
    setProfilesError("");
    update("model", modelId);
  }

  function searchModel(value: string) {
    setModelQuery(value);
    const exact = cleanModels.find((model) => model.name === value);
    if (exact) chooseModel(exact.id);
    else if (selection.model) chooseModel("");
  }

  return (
    <section className="global-baseline-section" id="global" data-testid="global-baseline">
      <div className="section-heading">
        <div><p className="eyebrow">GLOBAL BASELINE · NO EVENT-TYPE SPLIT</p><h2>Global dependence and rank stability</h2></div>
        <p>Global metrics are recomputed from target-level losses, never averaged across topics. The topic rows test whether the same pairs—and each model’s partner ordering—remain similarly ranked.</p>
      </div>

      <div className="global-scope-tabs" role="tablist" aria-label="Global baseline scope">
        {data.manifest.global_scopes.map((item) => <button key={item.id} role="tab" aria-selected={item.id === selection.scope} className={item.id === selection.scope ? "active" : ""} onClick={() => update("scope", item.id)}><strong>{item.label}</strong><span>{item.description}</span></button>)}
      </div>

      <div className="global-controls">
        <div className="cross-type-tabs" role="tablist" aria-label="Global baseline metric">
          {data.manifest.metrics.map((item) => <button key={item.id} role="tab" aria-selected={item.id === selection.metric} className={item.id === selection.metric ? "active" : ""} onClick={() => update("metric", item.id)}>{item.label}</button>)}
        </div>
        <div className="sample-toggle" role="group" aria-label="Global baseline sample">
          {data.manifest.samples.map((item) => <button key={item.id} aria-pressed={item.id === selection.sample} className={item.id === selection.sample ? "active" : ""} onClick={() => update("sample", item.id)}>{item.label}</button>)}
        </div>
        <div className="sample-toggle comparison-toggle" role="group" aria-label="Global comparison mode">
          {data.manifest.comparison_modes.map((item) => <button key={item.id} aria-pressed={item.id === selection.comparison} className={item.id === selection.comparison ? "active" : ""} onClick={() => update("comparison", item.id)}>{item.id === "leave_topic_out" ? "Transfer test" : "Inclusive benchmark"}</button>)}
        </div>
        <div className="cross-type-downloads">
          <a href={globalBaselineAssetUrl(data.manifest.pair_metrics_gzip)} download>Global pairs ↓</a>
          <a href={globalBaselineAssetUrl(data.manifest.pair_stability_csv)} download>Pair stability CSV ↓</a>
          <a href={globalBaselineAssetUrl(data.manifest.partner_stability_gzip)} download>Partner detail ↓</a>
          <a href={globalBaselineAssetUrl(data.manifest.ability_stability_csv)} download>Ability control ↓</a>
        </div>
      </div>

      <p className="global-comparison-note"><strong>{data.manifest.comparison_modes.find((item) => item.id === selection.comparison)?.label}.</strong> {data.manifest.comparison_modes.find((item) => item.id === selection.comparison)?.description}</p>

      <div className="global-summary-line" aria-label="Global pair summary">
        <div><span>Scope</span><strong>{scope?.label ?? selection.scope}</strong></div>
        <div><span>Pair universe</span><strong>{globalSummary?.n_pair_universe.toLocaleString() ?? "—"}</strong></div>
        <div><span>{selection.sample === "near_bi_both" ? "Near-BI global pairs" : sample?.label ?? "Active sample"}</span><strong>{globalSummary?.n_sample_pairs.toLocaleString() ?? "—"}</strong></div>
        <div><span>Defined pairs</span><strong>{globalSummary?.n_defined_pairs.toLocaleString() ?? "—"}</strong></div>
        <div className="global-summary-emphasis"><span>Global median · {metric?.label}</span><strong>{metricValue(globalSummary?.median, selection.metric)}</strong><small>{metricValue(globalSummary?.q25, selection.metric)}–{metricValue(globalSummary?.q75, selection.metric)} IQR</small></div>
      </div>

      <div className="global-stability-heading">
        <div><p className="eyebrow">GLOBAL → TOPIC ORDERING</p><h3>Does the global ranking survive conditioning?</h3></div>
        <div className="global-rank-legend"><span>Reversal</span><i /><span>Stable</span><small>Spearman −1 to +1</small></div>
      </div>

      <div className="global-topic-table" role="table" aria-label="Global to topic rank stability">
        <div className="global-topic-row header" role="row"><span>Event type</span><span>Pair-rank ρ</span><span>Partner-rank median ρ</span><span>Individual BI ρ</span><span>Common pairs</span></div>
        {data.manifest.topics.map((topic) => {
          const pair = pairRows.find((row) => row.topic_id === topic.id);
          const partner = partnerRows.find((row) => row.topic_id === topic.id);
          const ability = abilityRows.find((row) => row.topic_id === topic.id);
          if (!pair) return null;
          const insufficient = pair.interpretation_status === "insufficient" || !finite(pair.spearman);
          const score = finite(pair.spearman) ? (pair.spearman + 1) / 2 : 0;
          return (
            <button
              type="button"
              className={`global-topic-row ${pair.interpretation_status} ${selection.topic === topic.id ? "active" : ""}`}
              key={topic.id}
              onClick={() => update("topic", selection.topic === topic.id ? "" : topic.id)}
              aria-label={`${topic.label_en}: ${insufficient ? "insufficient evidence" : `pair-rank Spearman ${coefficient(pair.spearman)}`}`}
            >
              <span className="global-topic-name"><i style={insufficient ? undefined : { background: colorForScore(score) }} />{topic.label_en}<small>{statusText(pair.interpretation_status)}</small></span>
              <span className="global-pair-score" style={insufficient ? undefined : { color: textColorForScore(score), background: colorForScore(score) }}>{coefficient(pair.spearman)}</span>
              <span><RankTrack value={partner?.median_spearman} status={partner?.interpretation_status} /><b>{evidenceCoefficient(partner?.median_spearman, partner?.interpretation_status)}</b></span>
              <span><RankTrack value={ability?.spearman} status={ability?.interpretation_status} /><b>{evidenceCoefficient(ability?.spearman, ability?.interpretation_status)}</b></span>
              <span>{pair.n_defined_pairs.toLocaleString()}<small>of {pair.n_pair_universe.toLocaleString()}</small></span>
            </button>
          );
        })}
      </div>

      {selectedPair && <TopicDetail pair={selectedPair} partner={selectedPartner} ability={selectedAbility} topicLabel={topicLabels.get(selectedPair.topic_id) ?? selectedPair.topic_id} />}

      <div className="global-model-profile">
        <div className="global-model-heading">
          <div><p className="eyebrow">FOCAL MODEL CHECK</p><h3>Does one model keep the same partner ordering?</h3><p>Select an exact model to compare its global partner ranking with every event type under the active metric and sample.</p></div>
          <label><span>SEARCH EXACT MODEL</span><input type="search" list="global-model-options" aria-label="Global focal model" value={modelQuery} placeholder="Type a model name" onChange={(event) => searchModel(event.target.value)} /><datalist id="global-model-options">{cleanModels.map((model) => <option value={model.name} key={model.id} />)}</datalist></label>
        </div>
        {profilesLoading && <p className="global-profile-status">Loading audited model-level profiles…</p>}
        {profilesError && <p className="global-profile-status error">{profilesError}</p>}
        {selection.model && profiles && profileRows.length === 0 && <p className="global-profile-status">No reportable partner-ordering rows are available for this exact model under the active filters.</p>}
        {profileRows.length > 0 && (
          <div className="global-profile-table" data-testid="global-model-profile">
            <div className="global-profile-row header"><span>Event type</span><span>Partner ρ</span><span>Partners</span><span>Global top complementary partner</span><span>Retained</span><span>Topic percentile</span></div>
            {profileRows.map((row) => {
              const insufficient = row.interpretation_status === "insufficient";
              return <div className={`global-profile-row ${row.interpretation_status}`} key={row.topic_id}><span>{topicLabels.get(row.topic_id) ?? row.topic_id}</span><strong>{evidenceCoefficient(row.spearman, row.interpretation_status)}</strong><span>{row.n_defined_partners.toLocaleString()}</span><span title={insufficient ? "" : row.global_top_complementary_partner_name ?? ""}>{insufficient ? "—" : row.global_top_complementary_partner_name ?? "—"}</span><span>{insufficient || row.global_top_complementary_partner_retained === null || row.global_top_complementary_partner_retained === undefined ? "—" : row.global_top_complementary_partner_retained ? "Yes" : "No"}</span><span>{evidencePercent(row.global_top_complementary_partner_topic_percentile, row.interpretation_status)}</span></div>;
            })}
          </div>
        )}
      </div>

      <p className="global-baseline-footnote">Pair and partner coefficients use identical pair/partner intersections in the global and topic slices. Individual-model BI ranks are a separate ability control. Missing and sub-threshold estimates remain uncolored.</p>
    </section>
  );
}
