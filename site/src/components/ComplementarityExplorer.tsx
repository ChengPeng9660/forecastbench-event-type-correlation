import { useEffect, useMemo, useState } from "react";
import { COMPLEMENTARITY_PATH, COVERAGES, csvForPairs, defaultPair, eligiblePairs, isScore, loadComplementarity, pairGain, score, shortModel, studyCohort } from "../lib/complementarity";
import type { CohortKind, ComplementarityData, Dimension, Language, Score, StudyPair } from "../types/complementarity";
import "../complementarity.css";

type Copy = (zh: string, en: string) => string;
type View = { language: Language; dimension: Dimension; coverage: number; cohort: CohortKind; method: string; pair: string };
const GROUP_NAMES: Record<string, [string, string]> = {
  politics_conflict: ["政治与冲突", "Politics"], finance_economics: ["财经与经济", "Finance"],
  climate_weather: ["气候与天气", "Climate"], health_science: ["健康与科学", "Health & science"],
  technology_ai: ["科技与 AI", "Technology & AI"], sports: ["体育", "Sports"],
  entertainment_culture: ["娱乐与文化", "Culture"], polymarket: ["Polymarket", "Polymarket"],
  metaculus: ["Metaculus", "Metaculus"], manifold: ["Manifold", "Manifold"],
  infer: ["INFER", "INFER"], acled: ["ACLED", "ACLED"], dbnomics: ["DBnomics", "DBnomics"],
  fred: ["FRED", "FRED"], wikipedia: ["Wikipedia", "Wikipedia"], yfinance: ["Yahoo Finance", "Yahoo Finance"],
};
const A = "#d69308", B = "#73818e", PURPLE = "#4f207f", GOLD = "#dfac41";
const nameGroup = (group: string, t: Copy) => GROUP_NAMES[group] ? t(...GROUP_NAMES[group]) : group;
const pct = (n: Score | undefined, digits = 0) => isScore(n) ? `${(n * 100).toFixed(digits)}%` : "—";

function initialView(): View {
  const q = new URLSearchParams(window.location.search);
  const coverage = Number(q.get("cc_coverage") ?? .5);
  return { language: q.get("cc_lang") === "en" ? "en" : "zh", dimension: q.get("cc_dim") === "source" ? "source" : "topic",
    coverage: COVERAGES.some(v => v === coverage) ? coverage : .5, cohort: q.get("cc_cohort") === "eligible" ? "eligible" : "crossing",
    method: q.get("cc_method") ?? "type_shrunk", pair: q.get("cc_pair") ?? "44_58" };
}
function extent(values: number[], pad = .08): [number, number] {
  const low = Math.min(0, ...values), high = Math.max(0, ...values);
  const range = high - low || 1;
  return [low - range * pad, high + range * pad];
}
const linear = (value: number, domain: [number, number], range: [number, number]) => range[0] + (value - domain[0]) / (domain[1] - domain[0] || 1) * (range[1] - range[0]);
const ticks = (domain: [number, number], n = 4) => Array.from({ length: n + 1 }, (_, i) => domain[0] + i * (domain[1] - domain[0]) / n);

function SectionLabel({ index, label, title, children }: { index: string; label: string; title: string; children?: React.ReactNode }) {
  return <div className="cc-section-heading"><div><p className="cc-eyebrow"><span>{index}</span> {label}</p><h2>{title}</h2></div>{children && <div className="cc-heading-note">{children}</div>}</div>;
}
function ModelLegend({ pair, method, t }: { pair: StudyPair; method: string; t: Copy }) {
  return <div className="cc-model-legend"><span><i style={{ background: A }} />A · {shortModel(pair.model_a)}</span><span><i style={{ background: B }} />B · {shortModel(pair.model_b)}</span><span><i className="cc-legend-triangle" />{t("测试聚合", "Test aggregation")} · {method}</span></div>;
}

function AbilityProfile({ pair, method, t }: { pair: StudyPair; method: string; t: Copy }) {
  const [compact, setCompact] = useState(false), [mobilePanel, setMobilePanel] = useState(1);
  useEffect(() => { const media = window.matchMedia("(max-width: 700px)"); const update = () => setCompact(media.matches); update(); media.addEventListener("change", update); return () => media.removeEventListener("change", update); }, []);
  const groups = [...pair.profiles].sort((a, b) => {
    const rank = (g: string) => g === pair.group_a ? 0 : g === pair.group_b ? 1 : 2;
    return rank(a.group) - rank(b.group) || a.group.localeCompare(b.group);
  });
  const rows = [{ group: "overall", train_bi_a: pair.train_bi_a, train_bi_b: pair.train_bi_b,
    test_bi_a: pair.test_bi_a, test_bi_b: pair.test_bi_b, train_events: pair.train_events, test_events: pair.test_events,
    test_support_ok: true, methods: pair.methods }, ...groups];
  const values = rows.flatMap(r => [r.train_bi_a, r.train_bi_b, r.test_bi_a, r.test_bi_b, r.methods[method]]).filter(isScore);
  const low = values.length ? Math.floor((Math.min(...values) - 2) / 5) * 5 : 0;
  const high = values.length ? Math.ceil((Math.max(...values) + 2) / 5) * 5 : 100;
  const domain: [number, number] = [low, high], bottom = 75 + rows.length * 67;
  const ranges: [number, number][] = [[150, 380], [446, 676]];
  const panels = compact ? [mobilePanel] : [0, 1], width = compact ? 415 : 710;
  return <figure className={`cc-profile ${compact ? "cc-profile-compact" : ""}`} data-testid="cc-profile">
    {compact && <div className="cc-segments cc-profile-switch" role="group" aria-label={t("查看训练或测试能力", "View training or test ability")}><button aria-pressed={mobilePanel === 0} onClick={() => setMobilePanel(0)}>{t("训练 · 识别强项", "Training strengths")}</button><button aria-pressed={mobilePanel === 1} onClick={() => setMobilePanel(1)}>{t("测试 · 检查复现", "Test transfer")}</button></div>}
    <div className="cc-chart-scroll">
    <svg viewBox={`0 0 ${width} ${bottom + 37}`} role="img" aria-label={t("训练与测试的类别能力对比", "Category ability in training and test")}>
      <title>{shortModel(pair.model_a)} / {shortModel(pair.model_b)}</title>
      {panels.map((panel, slot) => { const range = ranges[slot]; return <g key={panel}>
        <text x={(range[0] + range[1]) / 2} y="22" textAnchor="middle" className="cc-chart-heading">{panel === 0 ? t("训练 · 识别强项", "TRAIN · identify strengths") : t("测试 · 检查复现", "TEST · check transfer")}</text>
        {ticks(domain).map(v => <g key={v}><line x1={linear(v, domain, range)} x2={linear(v, domain, range)} y1="43" y2={bottom - 20} className="cc-grid-line" /><text x={linear(v, domain, range)} y={bottom} textAnchor="middle" className="cc-axis-text">{v.toFixed(0)}</text></g>)}
      </g>; })}
      {rows.map((r, index) => {
        const y = 66 + index * 67;
        return <g key={r.group}>
          {index === 0 && <rect x="0" y={y - 24} width={width - 5} height="54" rx="4" fill="#f5f1f8" />}
          <text x="4" y={y - 3} className={index === 0 ? "cc-row-label cc-overall-label" : "cc-row-label"}>{r.group === "overall" ? t("整体能力", "Overall") : nameGroup(r.group, t)}</text>
          <text x="4" y={y + 15} className="cc-axis-text">{r.train_events} / {r.test_events} {t("事件", "events")}</text>
          {panels.map((panel, slot) => {
            const range = ranges[slot];
            const av = panel === 0 ? r.train_bi_a : r.test_bi_a, bv = panel === 0 ? r.train_bi_b : r.test_bi_b;
            const agg = panel === 1 ? r.methods[method] : null;
            const sparse = panel === 1 && !r.test_support_ok;
            return <g key={panel} opacity={sparse ? .38 : 1}>
              {isScore(av) && isScore(bv) && <line x1={linear(av, domain, range)} x2={linear(bv, domain, range)} y1={y} y2={y} stroke="#d1c6d9" strokeWidth="3" />}
              {isScore(av) && <g><circle cx={linear(av, domain, range)} cy={y} r="5.5" fill={A} /><text x={linear(av, domain, range)} y={y - 12} textAnchor="middle" fill={A} className="cc-point-value">{score(av, 1)}</text></g>}
              {isScore(bv) && <g><circle cx={linear(bv, domain, range)} cy={y} r="5.5" fill={B} stroke="white" strokeWidth="1.5" /><text x={linear(bv, domain, range)} y={y + 20} textAnchor="middle" fill={B} className="cc-point-value">{score(bv, 1)}</text></g>}
              {isScore(agg) && <path d={`M${linear(agg, domain, range)},${y - 7}l-5.5,11h11Z`} fill={PURPLE} stroke="white" strokeWidth="1"><title>{t("聚合 BI", "Aggregation BI")}: {score(agg)}</title></path>}
              {!isScore(av) && !isScore(bv) && <text x={(range[0] + range[1]) / 2} y={y + 4} textAnchor="middle" className="cc-axis-text">{t("不可计算", "Undefined")}</text>}
            </g>;
          })}
        </g>;
      })}
      <text x={compact ? 245 : 416} y={bottom + 27} textAnchor="middle" className="cc-axis-text">{compact ? t("BI 越右越好 · 训练 / 测试相同刻度", "BI → better · same train/test scale") : t("Brier Index · 越右越好 · 两侧使用相同刻度", "Brier Index · further right is better · shared scale")}</text>
    </svg>
  </div><figcaption>{t("数字为 A / B 的 BI；每类下方是训练 / 测试事件数。淡化的测试类别少于 30 个事件，不能据此确认强项复现。", "Numbers show each model’s BI; labels show train / test event counts. Faded test categories have fewer than 30 events and do not confirm skill transfer.")}</figcaption></figure>;
}

function GainBars({ rows, t, unit = "BI", decimals = 3, sharedDomain }: { rows: { label: string; value: Score; color?: string; detail?: string }[]; t: Copy; unit?: string; decimals?: number; sharedDomain?: [number, number] }) {
  const domain = sharedDomain ?? extent(rows.map(r => r.value).filter(isScore), .15), range: [number, number] = [230, 560];
  const zero = linear(0, domain, range), height = rows.length * 54 + 46;
  return <div className="cc-chart-scroll"><svg viewBox={`0 0 660 ${height}`} role="img" aria-label={t("收益比较", "Gain comparison")} className="cc-gain-svg">
    <line x1={zero} x2={zero} y1="6" y2={height - 30} className="cc-zero-line" />
    {rows.map((r, i) => { const y = i * 54 + 27, end = isScore(r.value) ? linear(r.value, domain, range) : zero;
      return <g key={`${r.label}-${i}`}><text x="2" y={y + 1} className="cc-row-label">{r.label}</text>{r.detail && <text x="2" y={y + 17} className="cc-axis-text">{r.detail}</text>}
        {isScore(r.value) ? <><rect x={Math.min(zero, end)} y={y - 13} width={Math.max(.8, Math.abs(end - zero))} height="22" rx="2" fill={r.color ?? (r.value > 0 ? PURPLE : GOLD)} /><text x="652" y={y + 3} textAnchor="end" className="cc-gain-label">{score(r.value, decimals, true)}</text></> : <text x="652" y={y + 3} textAnchor="end" className="cc-axis-text">—</text>}</g>;
    })}
    <text x={zero} y={height - 9} textAnchor="middle" className="cc-axis-text">0</text><text x="555" y={height - 9} textAnchor="end" className="cc-axis-text">{unit}</text>
  </svg></div>;
}

function GainInspector({ pair, method, methodLabel, t }: { pair: StudyPair; method: string; methodLabel: string; t: Copy }) {
  const globalGain = pairGain(pair, "global_convex", "single"), fullGain = pairGain(pair, method, "single"), increment = pairGain(pair, method);
  const categoryMethod = ["type_shrunk", "type_router", "cv_gated_type"].includes(method);
  return <aside className="cc-gain-inspector" data-testid="cc-gain-inspector">
    <p className="cc-eyebrow">{t("同一批测试题目", "IDENTICAL TEST TARGETS")}</p>
    <h3>{t("聚合收益从哪里来？", "Where does the gain come from?")}</h3>
    <div className={`cc-big-number ${isScore(increment) && increment < 0 ? "cc-negative" : ""}`}>{score(increment, 3, true)}<span>BI</span></div>
    <p className="cc-number-caption">{categoryMethod ? t("按类别聚合，相对全局混合的额外增量", "Extra gain from category pooling over global pooling") : t("选中方法，相对全局混合的增量", "Selected method’s increment over global pooling")}</p>
    <GainBars t={t} rows={[{ label: t("全局混合", "Global convex"), value: globalGain, color: B }, { label: methodLabel, value: fullGain, color: PURPLE }]} />
    <p className="cc-caption">{t("两条柱均相对测试较强单模型。它们的差才是相对全局混合的增量。", "Both bars use the better whole-test single model as baseline. Their difference is the increment over global pooling.")}</p>
    <dl className="cc-score-list"><div><dt>{t("模型 A · 测试 BI", "Model A · test BI")}</dt><dd>{score(pair.test_bi_a)}</dd></div><div><dt>{t("模型 B · 测试 BI", "Model B · test BI")}</dt><dd>{score(pair.test_bi_b)}</dd></div><div><dt>{t("全局混合 · 测试 BI", "Global pooling · test BI")}</dt><dd>{score(pair.methods.global_convex)}</dd></div><div className="cc-score-selected"><dt>{methodLabel} · BI</dt><dd>{score(pair.methods[method])}</dd></div></dl>
    {method === "best_single" && <p className="cc-inline-caution">{t("Best single 用测试结果事后选出，仅作参照，不能部署。", "Best single is selected in hindsight from test outcomes; it is a reference, not a deployable method.")}</p>}
    <p className="cc-insight">{categoryMethod ? t("类别信息的增量 ≠ 聚合超过单模型的全部收益。", "The category increment is not the whole gain over a single model.") : t("不使用类别信息的方法，其收益不能解释为类别互补的收益。", "Gains from a method without category information cannot be attributed to category specialization.")}</p>
  </aside>;
}

function PairScatter({ pairs, selected, method, select, t }: { pairs: StudyPair[]; selected?: StudyPair; method: string; select: (id: string) => void; t: Copy }) {
  const [hovered, setHovered] = useState<string | null>(null);
  const points = pairs.map(p => ({ p, x: p.train_between_norm, y: pairGain(p, method) })).filter((p): p is { p: StudyPair; x: number; y: number } => isScore(p.x) && isScore(p.y));
  const xd: [number, number] = [0, Math.max(.001, ...points.map(p => p.x)) * 1.06];
  const yd = extent(points.map(p => p.y), .12), xr: [number, number] = [75, 855], yr: [number, number] = [340, 25];
  const hoveredPoint = points.find(p => p.p.id === hovered) ?? points.find(p => p.p.id === selected?.id);
  return <figure className="cc-scatter"><div className="cc-chart-scroll"><svg viewBox="0 0 890 410" role="group" aria-label={t("训练类别互补与测试增量散点图", "Training category complementarity versus test increment")}>
    {ticks(xd).map(v => <g key={`x-${v}`}><line x1={linear(v, xd, xr)} x2={linear(v, xd, xr)} y1={yr[1]} y2={yr[0]} className="cc-grid-line" /><text x={linear(v, xd, xr)} y="364" textAnchor="middle" className="cc-axis-text">{score(v)}</text></g>)}
    {ticks(yd).map(v => <g key={`y-${v}`}><line x1={xr[0]} x2={xr[1]} y1={linear(v, yd, yr)} y2={linear(v, yd, yr)} className="cc-grid-line" /><text x="62" y={linear(v, yd, yr) + 4} textAnchor="end" className="cc-axis-text">{score(v, 2)}</text></g>)}
    <line x1={xr[0]} x2={xr[1]} y1={linear(0, yd, yr)} y2={linear(0, yd, yr)} className="cc-zero-line" />
    <text x="850" y={linear(0, yd, yr) - 8} textAnchor="end" className="cc-axis-text">{t("与全局混合持平", "Equal to global pooling")}</text>
    {points.map(({ p, x, y }) => <circle key={p.id} cx={linear(x, xd, xr)} cy={linear(y, yd, yr)} r={p.id === selected?.id ? 6.5 : 4} fill={y > 1e-10 ? PURPLE : GOLD} opacity={p.id === selected?.id || p.id === hovered ? 1 : .58}
      stroke={p.id === selected?.id ? "#201329" : "white"} strokeWidth={p.id === selected?.id ? 2 : .7} tabIndex={0} role="button" aria-pressed={p.id === selected?.id}
      aria-label={`${shortModel(p.model_a)} + ${shortModel(p.model_b)}; ${t("增量", "increment")} ${score(y, 3, true)} BI`}
      onMouseEnter={() => setHovered(p.id)} onMouseLeave={() => setHovered(null)} onFocus={() => setHovered(p.id)} onBlur={() => setHovered(null)}
      onClick={() => select(p.id)} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(p.id); } }}>
      <title>{shortModel(p.model_a)} + {shortModel(p.model_b)} · {score(y, 3, true)} BI</title>
    </circle>)}
    <text x="470" y="395" textAnchor="middle" className="cc-axis-title">{t("训练集跨类别互补 Dtype（归一化） →", "Training cross-category complementarity Dtype (normalized) →")}</text>
    <text transform="translate(17 195) rotate(-90)" textAnchor="middle" className="cc-axis-title">{t("测试：选中方法 − 全局混合（BI）", "Test: selected method − global pooling (BI)")}</text>
  </svg></div><div className="cc-scatter-legend"><span><i style={{ background: PURPLE }} />{t("超过全局混合", "Above global pooling")}</span><span><i style={{ background: GOLD }} />{t("未超过 / 持平", "Below / tied")}</span><span>{points.length} / {pairs.length} {t("个坐标可计算", "coordinates defined")}</span></div>
    <div className="cc-hover-readout" aria-live="polite">{hoveredPoint ? <><strong>{shortModel(hoveredPoint.p.model_a)} + {shortModel(hoveredPoint.p.model_b)}</strong><span>D<sub>type</sub> {score(hoveredPoint.x)} · {t("测试增量", "Test increment")} <b>{score(hoveredPoint.y, 3, true)} BI</b></span></> : t("点击一个点，上方模型能力图会同步更新。", "Select a point to update the ability profile above.")}</div>
  </figure>;
}

function MatchedChart({ data, dimension, t }: { data: ComplementarityData; dimension: Dimension; t: Copy }) {
  const rows = [...data.matched.filter(r => r.dimension === dimension)].sort((a, b) => a.coverage_threshold - b.coverage_threshold);
  const domain = extent(rows.flatMap(r => [r.ci_low, r.ci_high]).filter(isScore), .23), range: [number, number] = [170, 680];
  return <><div className="cc-chart-scroll"><svg viewBox="0 0 900 285" role="img" aria-label={t("固定基础模型的匹配对照", "Same-anchor matched controls")}>
    <line x1={linear(0, domain, range)} x2={linear(0, domain, range)} y1="10" y2="232" className="cc-zero-line" />
    {rows.map((r, i) => { const y = i * 57 + 35; return <g key={r.coverage_threshold}>
      <text x="4" y={y} className="cc-row-label">{pct(r.coverage_threshold)} {r.coverage_threshold === .8 ? t("原主方案", "original") : t("敏感性", "sensitivity")}</text>
      <text x="4" y={y + 18} className="cc-axis-text">n = {r.triplets}</text>
      {isScore(r.estimate) && isScore(r.ci_low) && isScore(r.ci_high) ? <><line x1={linear(r.ci_low, domain, range)} x2={linear(r.ci_high, domain, range)} y1={y} y2={y} stroke={PURPLE} strokeWidth="2" />{[r.ci_low, r.ci_high].map((v, j) => <line key={j} x1={linear(v, domain, range)} x2={linear(v, domain, range)} y1={y - 6} y2={y + 6} stroke={PURPLE} />)}<circle cx={linear(r.estimate, domain, range)} cy={y} r="6" fill={PURPLE} /><text x="893" y={y} textAnchor="end" className="cc-gain-label">{score(r.estimate, 3, true)} BI</text><text x="893" y={y + 18} textAnchor="end" className="cc-axis-text">[{score(r.ci_low)}, {score(r.ci_high)}]</text></> : <text x="440" y={y} textAnchor="middle" className="cc-axis-text">{t("没有满足条件的匹配，无法估计", "No eligible matched controls; not estimable")}</text>}
    </g>; })}
    {ticks(domain).map(v => <text key={v} x={linear(v, domain, range)} y="260" textAnchor="middle" className="cc-axis-text">{score(v, 2)}</text>)}
    <text x="440" y="284" textAnchor="middle" className="cc-axis-title">{t("高互补组 − 对照组：类别聚合额外增量之差（BI）", "High-complementarity minus control: difference in type-over-global increments (BI)")}</text>
  </svg></div><p className="cc-caption">{t("固定同一基础模型，三模型使用相同题目，匹配整体能力差和总 POG。横线为共享事件簇的条件 95% 区间；跨过 0 表示当前对照无法明确区分。不同门槛会重新选择匹配，不是独立实验。", "Same anchor, identical three-model targets, and similar overall ability gaps and total POG. Lines are conditional 95% shared-event intervals. Intervals crossing zero do not distinguish the groups clearly. Matches are reselected by threshold and are not independent studies.")}</p></>;
}

function EvidenceControls({ data, dimension, coverage, cohort, t }: { data: ComplementarityData; dimension: Dimension; coverage: number; cohort: CohortKind; t: Copy }) {
  const [tab, setTab] = useState<"matched" | "labels" | "time">("matched");
  const labels = data.labels.filter(r => r.dimension === dimension && r.cohort === (cohort === "crossing" ? "train_crossing" : "all_eligible")).sort((a, b) => a.coverage_threshold - b.coverage_threshold);
  const timeSplits = ["temporal_2026", "temporal_late", "novel_temporal_2026", "novel_temporal_late"];
  const timeNames = [t("2026 年时间留出", "2026 time holdout"), t("较晚时间留出", "Late time holdout"), t("2026 年 · 仅新事件", "2026 · novel events only"), t("较晚时间 · 仅新事件", "Late · novel events only")];
  const random = data.cohorts.filter(c => /^2026091[0-4]$/.test(c.split) && c.dimension === dimension && c.threshold === coverage && c.cohort === cohort);
  const increment = (c: ReturnType<typeof studyCohort>): Score => c?.type_increment_mean ?? null;
  const randomValues = random.map(increment).filter(isScore);
  return <div className="cc-controls-panel"><div className="cc-tabs" role="tablist" aria-label={t("对照实验", "Control experiments")}>
    {([['matched', t("同能力匹配", "Skill-matched controls")], ['labels', t("打乱类别标签", "Shuffle category labels")], ['time', t("时间与新事件", "Time & novel events")]] as const).map(([id, label]) => <button key={id} role="tab" id={`cc-tab-${id}`} aria-controls={`cc-panel-${id}`} aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>)}
  </div><p className="cc-control-scope">{t("以下固定检验 Category-shrunk 相对 Global convex 的增量，不随上方方法选择改变。", "These controls always evaluate Category-shrunk minus Global convex, independently of the method selected above.")}</p>
    <div role="tabpanel" id={`cc-panel-${tab}`} aria-labelledby={`cc-tab-${tab}`} className="cc-control-content">
      {tab === "matched" && <><h3>{t("能力和题目都接近，互补组还更好吗？", "With skill and targets matched, does complementarity still help?")}</h3><MatchedChart data={data} dimension={dimension} t={t} /><p className="cc-insight">{t("这是观察性匹配，不能证明类别互补造成了收益；稀疏与负结果都保留。", "This observational match does not establish causation; sparse and negative results are retained.")}</p></>}
      {tab === "labels" && <><h3>{t("去掉类别含义，收益还在吗？", "Does the gain survive without the real category labels?")}</h3><div className="cc-label-comparisons">{labels.map(r => <div key={r.coverage_threshold} className={r.coverage_threshold === coverage ? "is-selected" : ""}><div className="cc-mini-heading"><strong>{pct(r.coverage_threshold)} {r.coverage_threshold === .8 ? t("原主方案", "original") : t("敏感性", "sensitivity")}</strong><span>n = {r.pairs}</span></div><GainBars t={t} sharedDomain={extent(labels.flatMap(v => [v.actual_bi, v.control_bi]).filter(isScore), .15)} rows={[{ label: t("真实类别", "Real labels"), value: r.actual_bi, color: PURPLE }, { label: t("打乱后的平均", "Shuffled mean"), value: r.control_bi, color: B }]} /><p className="cc-caption">{t("真实 − 打乱", "Real − shuffled")}: <strong>{score(r.actual_minus_control_bi, 3, true)} BI</strong></p></div>)}</div><p className="cc-caption">{t("30 次固定打乱；模型预测、答案和整体题目不变。类型标签在真实来源内部打乱，来源标签在 origin × topic 内打乱。类别样本量和回退范围仍可能变化；来源与类型的关联限制了打乱幅度，因此这不是精确因果检验。", "Thirty fixed shuffles leave forecasts, outcomes and whole-pair targets unchanged. Topics shuffle within real source; sources within origin × topic. Category support and fallback can change, and source/topic entanglement limits changed labels. This is not an exact causal test.")}</p></>}
      {tab === "time" && <><h3>{t("离开这一次划分，增量还在吗？", "Does the increment extend beyond this split?")}</h3><div className="cc-random-strip"><div><strong>{randomValues.filter(v => v > 1e-10).length} / {randomValues.length}</strong><span>{t("随机方向的平均增量为正", "random directions with positive mean increments")}</span></div><div className="cc-random-dots">{random.map(c => { const value = increment(c); return <span key={`${c.split}-${c.fold}`} className={isScore(value) && value > 0 ? "is-positive" : ""} title={`${c.split} · ${c.fold === 0 ? 'A→B' : 'B→A'}: ${score(value, 3, true)} BI`}>{score(value, 3, true)}</span>; })}</div></div>
        <GainBars t={t} rows={timeSplits.map((split, i) => { const c = studyCohort(data, dimension, coverage, cohort, split, 0); return { label: timeNames[i], value: increment(c), detail: c ? `${c.n} ${t("对", "pairs")} · ${c.n_crossing_persistence} ${t("对可检验双强项", "with evaluable crossed strengths")}` : t("无可评估组合", "No evaluable pairs") }; })} />
        <p className="cc-caption">{t("随机方向来自 5 次双向事件划分，彼此相关。仅新事件的时间回测排除了训练中见过的事件，但仍使用已研究的历史档案和较晚的评分快照，不是未触碰的未来确认集。", "Random directions come from five bidirectional event splits and are dependent. Novel-event views remove events seen in training, but use a studied historical archive and later scoring snapshot; they are not untouched future confirmation sets.")}</p></>}
    </div></div>;
}

function Study({ data }: { data: ComplementarityData }) {
  const [view, setView] = useState<View>(() => { const v = initialView(); return { ...v, method: data.methods.some(m => m.id === v.method) ? v.method : "type_shrunk" }; });
  const [search, setSearch] = useState("");
  const t: Copy = (zh, en) => view.language === "zh" ? zh : en;
  const pairs = useMemo(() => eligiblePairs(data, view.dimension, view.coverage, view.cohort), [data, view.dimension, view.coverage, view.cohort]);
  const selected = defaultPair(pairs, view.pair);
  const searchable = pairs.filter(p => `${p.model_a} ${p.model_b}`.toLowerCase().includes(search.trim().toLowerCase()));
  const summary = studyCohort(data, view.dimension, view.coverage, view.cohort);
  const methodLabel = data.methods.find(m => m.id === view.method)?.label ?? view.method;
  const methodSummary = summary?.methods[view.method];
  const selectedIndex = searchable.findIndex(p => p.id === selected?.id);
  const ci = data.intervals.find(r => r.dimension === view.dimension && r.threshold === view.coverage && r.cohort === view.cohort && r.outcome === "type_increment_bi");
  const pooledIncrement = summary?.type_increment_mean ?? null;
  useEffect(() => { const restore = () => { const v = initialView(); setView({ ...v, method: data.methods.some(m => m.id === v.method) ? v.method : "type_shrunk" }); }; window.addEventListener("popstate", restore); return () => window.removeEventListener("popstate", restore); }, [data]);
  function change(patch: Partial<View>) {
    const next = { ...view, ...patch };
    const nextPairs = eligiblePairs(data, next.dimension, next.coverage, next.cohort);
    next.pair = defaultPair(nextPairs, next.pair)?.id ?? "";
    setView(next);
    const url = new URL(window.location.href);
    for (const [key, value] of Object.entries({ cc_lang: next.language, cc_dim: next.dimension, cc_coverage: next.coverage, cc_cohort: next.cohort, cc_method: next.method, cc_pair: next.pair })) url.searchParams.set(key, String(value));
    window.history.replaceState(window.history.state, "", url);
  }
  function download() {
    const url = URL.createObjectURL(new Blob(["\ufeff" + csvForPairs(pairs, view.method)], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `complementarity_${view.dimension}_${view.coverage}_${view.cohort}_${view.method}.csv`; link.click(); URL.revokeObjectURL(url);
  }
  return <section id="complementarity" className="cc-study" lang={view.language === "zh" ? "zh-CN" : "en"}>
    <header className="cc-intro"><div><p className="cc-eyebrow">FORECASTBENCH / COMPLEMENTARITY <span className="cc-study-status">{t("探索性研究", "EXPLORATORY STUDY")}</span></p><h1>{t("整体能力相近，类别强项不同。", "Similar overall skill. Different strengths.")}</h1><p>{t("看清模型在哪些类别互补，以及聚合能否把这种互补变成测试集上的增益。", "Explore where models have complementary strengths, and whether aggregation turns them into held-out gains.")}</p></div><div className="cc-language" aria-label="Language"><button type="button" aria-pressed={view.language === "zh"} onClick={() => change({ language: "zh" })}>中文</button><button type="button" aria-pressed={view.language === "en"} onClick={() => change({ language: "en" })}>EN</button></div></header>
    <div className="cc-study-meta"><span><b>{data.sample.scored_models}</b> {t("个固定模型配置", "exact configurations")}</span><span><b>{data.sample.genuine_scored_predictions.toLocaleString()}</b> {t("条真实预测", "genuine forecasts")}</span><span><b>{data.sample.events.toLocaleString()}</b> {t("个事件簇", "event clusters")}</span><span>{t("Zero-shot · 无额外信息 · 2026-08-31", "Zero-shot · no extra information · 2026-08-31")}</span></div>

    <div className="cc-filter-dock"><div><span className="cc-field-label">{t("按什么分组", "GROUP QUESTIONS BY")}</span><div className="cc-segments" role="group" aria-label={t("分组维度", "Grouping dimension")}><button aria-pressed={view.dimension === "topic"} onClick={() => { setSearch(""); change({ dimension: "topic" }); }}>{t("事件类型", "Event type")}</button><button aria-pressed={view.dimension === "source"} onClick={() => { setSearch(""); change({ dimension: "source" }); }}>{t("题目来源 / 平台", "Question source / platform")}</button></div></div>
      <label><span className="cc-field-label">{t("类别覆盖要求", "CATEGORY COVERAGE")}</span><select aria-label={t("类别覆盖要求", "Category coverage")} value={view.coverage} onChange={e => change({ coverage: Number(e.target.value) })}>{COVERAGES.map(c => <option key={c} value={c}>{pct(c)} · {c === .8 ? t("原主方案", "Original protocol") : t("追加敏感性", "Post-protocol sensitivity")}</option>)}</select></label>
      <label><span className="cc-field-label">{t("模型对范围", "PAIR COHORT")}</span><select aria-label={t("模型对范围", "Pair cohort")} value={view.cohort} onChange={e => change({ cohort: e.target.value as CohortKind })}><option value="crossing">{t("训练中各有强项", "Crossed training strengths")}</option><option value="eligible">{t("全部合格的近能力组合", "All eligible near-skill pairs")}</option></select></label>
      <label><span className="cc-field-label">{t("聚合方法", "AGGREGATION METHOD")}</span><select aria-label={t("互补实验聚合方法", "Complementarity aggregation method")} value={view.method} onChange={e => change({ method: e.target.value })}>{["research", "original", "hindsight"].map(kind => <optgroup key={kind} label={kind === "research" ? t("研究方法", "Research methods") : kind === "original" ? t("原有方法 · 公式不变", "Existing methods · unchanged") : t("事后参照", "Hindsight reference")}>{data.methods.filter(m => m.kind === kind).map(m => <option key={m.id} value={m.id}>{m.label}</option>)}</optgroup>)}</select></label>
    </div>
    <div className={`cc-scope-note ${view.coverage === .8 ? "cc-original" : ""}`} data-testid="cc-scope"><strong>{view.coverage === .8 ? t("原主方案 · 80%", "Original protocol · 80%") : t(`追加敏感性 · ${pct(view.coverage)}`, `Post-protocol sensitivity · ${pct(view.coverage)}`)}</strong><span>{t("覆盖率是满足样本要求的已知类别占训练评分权重的比例，不是题目行数占比。所有模型对整体训练 BI 差 ≤ 2；每类至少 30 个训练事件。", "Coverage is the share of training scoring weight in supported known categories, not the fraction of question rows. All pairs have overall training BI gap ≤ 2; categories need ≥ 30 training events.")}</span></div>

    <section className="cc-block cc-pair-block">
      <SectionLabel index="01" label="PAIR EXPLORER" title={t("先看一对模型的能力结构", "Start with one pair’s ability profile")}><span>{t("固定主事件划分 · 训练 A → 测试 B", "Primary event split · train A → test B")}</span><strong>{pairs.length} {t("个合格模型对", "eligible pairs")}</strong></SectionLabel>
      <div className="cc-pair-picker"><label className="cc-search-label"><span className="cc-field-label">{t("查找模型", "FIND A MODEL")}</span><input type="search" aria-label={t("查找模型对", "Find model pair")} placeholder={t("输入模型名称…", "Search model name…")} value={search} onChange={e => setSearch(e.target.value)} /></label><label className="cc-pair-select"><span className="cc-field-label">{t("选择具体模型对", "SELECT EXACT MODEL PAIR")}</span><select aria-label={t("选择具体模型对", "Select exact model pair")} value={searchable.some(p => p.id === selected?.id) ? selected?.id : ""} onChange={e => change({ pair: e.target.value })}><option value="" disabled>{searchable.length ? t("选择一个模型对", "Select a pair") : t("没有匹配名称", "No names match")}</option>{searchable.map(p => <option key={p.id} value={p.id}>{shortModel(p.model_a)} + {shortModel(p.model_b)}</option>)}</select></label><div className="cc-pair-step"><button aria-label={t("上一个模型对", "Previous pair")} disabled={selectedIndex <= 0} onClick={() => change({ pair: searchable[selectedIndex - 1].id })}>←</button><button aria-label={t("下一个模型对", "Next pair")} disabled={selectedIndex < 0 || selectedIndex >= searchable.length - 1} onClick={() => change({ pair: searchable[selectedIndex + 1].id })}>→</button></div></div>
      {selected ? <><div className="cc-pair-facts"><div><span>{t("整体训练 BI 差", "Overall train BI gap")}</span><strong>{score(selected.train_gap)}</strong><small>≤ 2</small></div><div><span>{t("整体测试 BI 差", "Overall test BI gap")}</span><strong>{score(selected.test_gap)}</strong><small>{t("仅诊断，不筛选", "diagnostic, not selection")}</small></div><div><span>{t("有效类别训练权重", "Supported category weight")}</span><strong>{pct(selected.train_coverage, 1)}</strong></div><div><span>{t("测试事件", "Test events")}</span><strong>{selected.test_events.toLocaleString()}</strong></div></div>
        <ModelLegend pair={selected} method={methodLabel} t={t} /><div className="cc-pair-layout"><AbilityProfile pair={selected} method={view.method} t={t} /><GainInspector pair={selected} method={view.method} methodLabel={methodLabel} t={t} /></div>
        <div className="cc-pair-footnote"><span className={`cc-transfer ${selected.crossing_persists === true ? "is-preserved" : ""}`}>{selected.crossing_persists === true ? t("两个训练强项在测试同时保持", "Both training specialists retain their advantage") : selected.crossing_persists === false ? t("两个训练强项未同时保持", "The two training strengths do not both persist") : t("双强项复现：支持不足或不适用", "Crossed-strength transfer: unsupported or not applicable")}</span>{selected.id === "44_58" && view.dimension === "topic" && <span>{t("此组合是事后选出的说明案例，并非确认性证据。", "This pair is a posthoc illustration, not confirmatory evidence.")}</span>}</div></> : <div className="cc-empty">{t("当前条件没有合格模型对。保留空结果，不以 0 或其他模型代替。", "No eligible pairs under these conditions. An empty result is not replaced by zero or another cohort.")}</div>}
    </section>

    <section className="cc-block">
      <SectionLabel index="02" label="ALL ELIGIBLE PAIRS" title={t("互补越多，额外收益就越大吗？", "Does more complementarity mean more extra gain?")}><button className="cc-text-button" onClick={download}>{t("下载当前模型对 CSV", "Download current pairs CSV")} ↗</button></SectionLabel>
      <div className="cc-cohort-stats"><div><span>{t("按类别收缩 − 全局混合", "Category-shrunk − global pooling")}</span><strong>{score(pooledIncrement, 3, true)} <small>BI</small></strong><small>{ci && isScore(ci.ci_low) ? `${t("条件 95% 区间", "Conditional 95% interval")} [${score(ci.ci_low)}, ${score(ci.ci_high)}]` : t("无可估计区间", "No estimable interval")}</small></div><div><span>{t("选中方法超过较强单模型", "Selected method vs better test single")}</span><strong>{score(methodSummary?.gain_best_bi, 3, true)} <small>BI</small></strong><small>{methodLabel} · n = {methodSummary?.n_bi ?? 0}</small></div><div><span>{t("两个强项同时保持", "Both training strengths persist")}</span><strong>{pct(summary?.crossing_persistence, 1)}</strong><small>{summary?.n_crossing_persistence ?? 0} / {pairs.length} {t("对可判断", "pairs evaluable")}</small></div></div>
      <PairScatter pairs={pairs} selected={selected} method={view.method} select={id => { setSearch(""); change({ pair: id }); }} t={t} />
      <p className="cc-caption">{t("每个点是一对固定模型；X 只从训练题目计算，Y 来自不同事件的测试题目。点击点会联动上方能力图。统计在模型对间不加权，共用事件的模型对不独立。", "Each point is one exact pair. X uses only training questions; Y uses different test events. Select a point to update the profile above. Pair summaries are unweighted; pairs sharing events are not independent.")}</p>
      <details className="cc-details"><summary>{t("对比全部聚合方法", "Compare all aggregation methods")}</summary><GainBars t={t} rows={data.methods.map(m => ({ label: m.label, value: summary?.methods[m.id]?.gain_best_bi ?? null, detail: m.kind === "hindsight" ? t("事后参照，不能部署", "Hindsight; not deployable") : m.kind === "original" ? t("原有公式", "Unchanged existing formula") : t("研究方法", "Research method") }))} /><p className="cc-caption">{t("均为同一队列中，超过测试较强单模型的平均 BI；不是类别信息的单独贡献。", "Mean BI gains over the better whole-test single, within the same cohort. These are not isolated contributions from category information.")}</p></details>
    </section>

    <section className="cc-block cc-mechanism-block">
      <SectionLabel index="03" label="POTENTIAL & REALIZATION" title={t("有互补潜力，为什么聚合仍会失败？", "Why can aggregation fail despite complementarity?")} />
      <div className="cc-mechanism-layout"><div><h3>{t("互补是否按类别组织起来？", "How much complementarity lies between categories?")}</h3><p>{t("总 POG 可以分成类别间与类别内两部分。你关心的是类别之间 A、B 各有所长的那一部分。", "Total POG separates into between-category and within-category components. Your hypothesis concerns the part where different categories favor different models.")}</p><div className="cc-pog-value">{pct(summary?.between_share_of_mean_pog, 1)}<span>{t("平均总 POG 中的类别间部分", "between-category share of mean total POG")}</span></div><div className="cc-pog-bar" role="img" aria-label={`${t("类别间占比", "Between-category share")}: ${pct(summary?.between_share_of_mean_pog, 1)}`}><span style={{ width: pct(summary?.between_share_of_mean_pog, 5) }} /></div><div className="cc-pog-legend"><span><i />{t("类别间", "Between categories")}</span><span>{t("其余：类别内逐题互补", "Remainder: within-category complementarity")}</span></div></div>
        <div><h3>{t("潜力 − 选错专家的损失 = 实际收益", "Potential − wrong-specialist cost = realized gain")}</h3><GainBars t={t} unit={t("原始 Brier 损失减少量", "Raw Brier-risk reduction")} decimals={5} rows={[{ label: t("测试类别互补潜力", "Category-oracle potential"), value: summary?.test_between_potential ?? null, color: GOLD }, { label: t("选错类别专家的损失", "Wrong-specialist cost"), value: isScore(summary?.test_misselection_regret) ? -summary.test_misselection_regret : null, color: B }, { label: t("硬路由的净收益", "Net hard-router gain"), value: summary?.scope_router_gain ?? null, color: PURPLE }]} /><p className="cc-caption">{t("这是按类别选一个模型的精确风险分解，使用同一保留测试范围。单位是 Brier loss，不是 BI；不能拿它分解全样本 BI。", "This exact decomposition applies to a one-model-per-category router on the same retained test scope. Units are Brier risk, not BI; it does not decompose whole-test BI.")}</p></div></div>
    </section>

    <section className="cc-block"><SectionLabel index="04" label="CHALLENGE THE EXPLANATION" title={t("换一组对照，结论还成立吗？", "Does the explanation survive the controls?")}><span>{t("正结果、负结果与空结果全部保留。", "Positive, negative and empty results all remain visible.")}</span></SectionLabel><EvidenceControls data={data} dimension={view.dimension} coverage={view.coverage} cohort={view.cohort} t={t} /></section>

    <section className="cc-block cc-methods-block"><SectionLabel index="05" label="METHODS & EVIDENCE" title={t("我们能支持什么论点？", "What can we actually argue?")} />
      <div className="cc-claim"><p>{t("整体能力相近，不代表类别能力结构相同。不同类别的比较优势提供互补潜力，但实际收益取决于能否可靠识别强项，并把它迁移到新的事件。", "Similar overall skill can hide different category strengths. These comparative advantages create complementarity potential, but realized gains depend on learning the specialists reliably and transferring them to new events.")}</p><span>{t("当前证据：具体案例与有限增量；尚未证明普遍、独立于能力、可稳定外推的 diversity 效应。", "Current evidence: illustrative cases and modest increments, not a universal, ability-independent or reliably transferable diversity effect.")}</span></div>
      <details className="cc-details"><summary>{t("指标定义与样本口径", "Metric definition and evaluation scope")}</summary><div className="cc-definition"><p>D<sub>type</sub> = min(R<sub>A</sub>, R<sub>B</sub>) − Σ<sub>g</sub> π<sub>g</sub> min(R<sub>A,g</sub>, R<sub>B,g</sub>)</p><span>{t("R 为 Brier loss，π 为相同评价范围内的类别权重。散点图再除以两模型在该范围的平均原始损失。若一方每类都更差，Dtype = 0。它衡量类别级 oracle 的潜力，不保证训练学到的聚合一定获益。", "R is Brier risk and π is category mass on the same evaluation scope. The scatter normalizes by the two models’ mean raw risk on that scope. Dtype is zero when one model is worse in every category. It measures category-oracle potential, not guaranteed gain from a learned aggregator.")}</span></div><ul><li>{t("整体训练 BI 差 ≤ 2，不要求类别内能力接近；类别交叉要求双方各有一类至少领先 1 BI。", "Overall training BI gap ≤ 2; no within-category skill-matching restriction. Crossed strengths require each model to lead by ≥ 1 conditional BI in a different category.")}</li><li>{t("训练和测试至少各 100 个独立事件；类别至少 30 个训练事件。新事件时间敏感性要求至少 50 个新测试事件。", "At least 100 distinct events in each train/test half and 30 training events per retained category. Novel-event temporal sensitivities require at least 50 new test events.")}</li><li>{t("Dataset / Market 整体等权；类别分数对同一套权重取条件，不重新平衡。未知或稀疏类别按预设规则回退，空值不是 0。", "Dataset / Market are balanced overall. Category scores condition these same weights without rebalancing. Unknown or sparse categories use fixed fallback rules; missing values are not zero.")}</li><li>{t("类型权重向全局权重收缩：n/(n+100)。原六种方法公式保持不变；Best single 是事后参照。", "Category weights shrink toward global weights with n/(n+100). The original six method formulas are unchanged; Best single is a hindsight reference.")}</li><li>{t("80% 是原主门槛；50/60/70% 在检查可行性和初步对照后追加，不能选最好的一行当作确认。", "80% is the original coverage rule; 50/60/70% were added after feasibility and initial controls. Do not select the best sensitivity as confirmation.")}</li></ul></details>
      <details className="cc-details"><summary>{t("数据限制与独立核对", "Data limitations and independent checks")}</summary><p>{t("已研究的历史档案不是未触碰确认集。类别缺失、来源与类型关联、模型和事件重复、较晚评分快照，以及缺少完整历史发布时间记录，都限制外推。高覆盖 topic 队列尤其稀疏。", "The studied historical archive is not an untouched confirmation set. Missing categories, source/topic entanglement, shared models/events, later scoring snapshots and incomplete historical publication times limit generalization. High-coverage topic cohorts are especially sparse.")}</p><p>{data.audit.implementation_tests} {t("项实现 / 理论测试", "implementation / theory tests")} · {data.audit.numeric_checks.toLocaleString()} {t("项独立数值核对。核对通过代表计算一致，不代表统计结论已被确认。", "independent numeric checks. Passing checks establish computational consistency, not confirmatory statistical evidence.")}</p><p>{t("接下来应盲于模型结果补齐类别标签，冻结方案，再用未研究过的后续事件确认。", "Next: complete category labels blind to model outcomes, freeze the design, then confirm on genuinely unstudied later events.")}</p></details>
      <div className="cc-downloads"><a href={`${COMPLEMENTARITY_PATH}REPORT.md`} download>{t("完整中文报告", "Chinese research report")} ↗</a><a href={`${COMPLEMENTARITY_PATH}ARGUMENT.md`} download>{t("英文论证草稿", "English argument draft")} ↗</a><a href={`${COMPLEMENTARITY_PATH}primary-pairs.csv`} download>{t("全部主折模型对 CSV", "All primary pair views CSV")} ↗</a><a href={`${COMPLEMENTARITY_PATH}manifest.json`}>{t("数据来源与校验", "Provenance & hashes")} ↗</a></div>
      <p className="cc-caption">{t("派生自 ForecastBench · CC BY-SA 4.0 · 每个点与统计量均来自已核对的实验输出。", "Derived from ForecastBench · CC BY-SA 4.0 · Every point and summary comes from the audited experiment outputs.")}</p>
    </section>
  </section>;
}

export default function ComplementarityExplorer() {
  const [data, setData] = useState<ComplementarityData | null>(null), [error, setError] = useState(""), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setError("");
    loadComplementarity(controller.signal).then(setData).catch(e => { if (!controller.signal.aborted) setError(String(e.message ?? e)); });
    return () => controller.abort();
  }, [attempt]);
  if (!data) return <section id="complementarity" className="cc-study cc-loading" aria-live="polite" aria-busy={!error}><p className="cc-eyebrow">FORECASTBENCH / COMPLEMENTARITY</p><h1>{error ? "实验数据暂时无法加载 / Results unavailable" : "正在准备交互实验 / Preparing the study"}</h1><p>{error || "加载已核对的模型对、类别能力与对照结果…"}</p>{error && <button className="research-button" onClick={() => setAttempt(a => a + 1)}>重新加载 / Try again</button>}</section>;
  return <Study data={data} />;
}
