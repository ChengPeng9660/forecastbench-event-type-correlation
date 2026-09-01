import { useEffect, useMemo, useState } from "react";
import { ABILITY_GAPS, COMPLEMENTARITY_METHODS, COMPLEMENTARITY_PATH, COVERAGES, csvForPairs, defaultPair, directionSummaries, eligiblePairs, isScore, loadComplementarity, pairGain, score, shortModel, studySummary } from "../lib/complementarity";
import type { AbilityGap, CohortKind, ComplementarityData, Dimension, Score, StudyPair } from "../types/complementarity";
import "../complementarity.css";

type Copy = (zh: string, en: string) => string;
type View = { dimension: Dimension; coverage: number; cohort: CohortKind; abilityGap: AbilityGap; method: string; pair: string };
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
const METHOD_SET = new Set<string>(COMPLEMENTARITY_METHODS);
const nameGroup = (group: string, t: Copy) => GROUP_NAMES[group] ? t(...GROUP_NAMES[group]) : group;
const pct = (n: Score | undefined, digits = 0) => isScore(n) ? `${(n * 100).toFixed(digits)}%` : "—";

function initialView(): View {
  const q = new URLSearchParams(window.location.search);
  const coverage = Number(q.get("cc_coverage") ?? .5);
  const abilityGap = Number(q.get("cc_gap") ?? 3);
  return { dimension: q.get("cc_dim") === "source" ? "source" : "topic",
    coverage: COVERAGES.some(v => v === coverage) ? coverage : .5, cohort: q.get("cc_cohort") === "eligible" ? "eligible" : "crossing",
    abilityGap: ABILITY_GAPS.some(v => v === abilityGap) ? abilityGap as AbilityGap : 3,
    method: METHOD_SET.has(q.get("cc_method") ?? "") ? q.get("cc_method")! : "cf_directional",
    pair: q.get("cc_pair") ?? "44_58" };
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
  const fullGain = pairGain(pair, method);
  const methodNote = method === "cf_directional"
    ? t("两个方向权重只在整个训练折上拟合；类别不参与拟合或路由。", "The two directional weights are fit on the whole training fold; categories do not tune or route the pool.")
    : t("这是固定、无需结果拟合的公式；类别不参与计算。", "This is a fixed outcome-blind formula; categories do not enter its calculation.");
  return <aside className="cc-gain-inspector" data-testid="cc-gain-inspector">
    <p className="cc-eyebrow">{t("同一批测试题目", "IDENTICAL TEST TARGETS")}</p>
    <h3>{t("聚合能超过两个模型吗？", "Does aggregation beat both models?")}</h3>
    <div className={`cc-big-number ${isScore(fullGain) && fullGain < 0 ? "cc-negative" : ""}`}>{score(fullGain, 3, true)}<span>BI</span></div>
    <p className="cc-number-caption">{t("相对同一测试题目上 BI 更高的单模型", "versus the higher-BI single model on the same test targets")}</p>
    <GainBars t={t} rows={[{ label: methodLabel, value: fullGain, color: PURPLE }]} />
    <p className="cc-caption">{t("柱形相对同一测试目标上的较强单模型。", "The bar uses the better single model on the identical test targets as its baseline.")}</p>
    <dl className="cc-score-list"><div><dt>{t("模型 A · 测试 BI", "Model A · test BI")}</dt><dd>{score(pair.test_bi_a)}</dd></div><div><dt>{t("模型 B · 测试 BI", "Model B · test BI")}</dt><dd>{score(pair.test_bi_b)}</dd></div><div className="cc-score-selected"><dt>{methodLabel} · BI</dt><dd>{score(pair.methods[method])}</dd></div></dl>
    <p className="cc-insight">{methodNote}</p>
  </aside>;
}

function PairScatter({ pairs, selected, method, select, t }: { pairs: StudyPair[]; selected?: StudyPair; method: string; select: (id: string) => void; t: Copy }) {
  const [hovered, setHovered] = useState<string | null>(null);
  const points = pairs.map(p => ({ p, x: p.train_between_norm, y: pairGain(p, method) })).filter((p): p is { p: StudyPair; x: number; y: number } => isScore(p.x) && isScore(p.y));
  const xd: [number, number] = [0, Math.max(.001, ...points.map(p => p.x)) * 1.06];
  const yd = extent(points.map(p => p.y), .12), xr: [number, number] = [75, 855], yr: [number, number] = [340, 25];
  const hoveredPoint = points.find(p => p.p.id === hovered) ?? points.find(p => p.p.id === selected?.id);
  return <figure className="cc-scatter"><div className="cc-chart-scroll"><svg viewBox="0 0 890 410" role="group" aria-label={t("训练类别互补与测试聚合收益散点图", "Training category complementarity versus whole-test aggregation gain")}>
    {ticks(xd).map(v => <g key={`x-${v}`}><line x1={linear(v, xd, xr)} x2={linear(v, xd, xr)} y1={yr[1]} y2={yr[0]} className="cc-grid-line" /><text x={linear(v, xd, xr)} y="364" textAnchor="middle" className="cc-axis-text">{score(v)}</text></g>)}
    {ticks(yd).map(v => <g key={`y-${v}`}><line x1={xr[0]} x2={xr[1]} y1={linear(v, yd, yr)} y2={linear(v, yd, yr)} className="cc-grid-line" /><text x="62" y={linear(v, yd, yr) + 4} textAnchor="end" className="cc-axis-text">{score(v, 2)}</text></g>)}
    <line x1={xr[0]} x2={xr[1]} y1={linear(0, yd, yr)} y2={linear(0, yd, yr)} className="cc-zero-line" />
    <text x="850" y={linear(0, yd, yr) - 8} textAnchor="end" className="cc-axis-text">{t("与较强单模型持平", "Equal to better single")}</text>
    {points.map(({ p, x, y }) => <circle key={p.id} cx={linear(x, xd, xr)} cy={linear(y, yd, yr)} r={p.id === selected?.id ? 6.5 : 4} fill={y > 1e-10 ? PURPLE : GOLD} opacity={p.id === selected?.id || p.id === hovered ? 1 : .58}
      stroke={p.id === selected?.id ? "#201329" : "white"} strokeWidth={p.id === selected?.id ? 2 : .7} tabIndex={0} role="button" aria-pressed={p.id === selected?.id}
      aria-label={`${shortModel(p.model_a)} + ${shortModel(p.model_b)}; ${t("聚合收益", "aggregation gain")} ${score(y, 3, true)} BI`}
      onMouseEnter={() => setHovered(p.id)} onMouseLeave={() => setHovered(null)} onFocus={() => setHovered(p.id)} onBlur={() => setHovered(null)}
      onClick={() => select(p.id)} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(p.id); } }}>
      <title>{shortModel(p.model_a)} + {shortModel(p.model_b)} · {score(y, 3, true)} BI</title>
    </circle>)}
    <text x="470" y="395" textAnchor="middle" className="cc-axis-title">{t("训练集跨类别互补 Dtype（归一化） →", "Training cross-category complementarity Dtype (normalized) →")}</text>
    <text transform="translate(17 195) rotate(-90)" textAnchor="middle" className="cc-axis-title">{t("测试：选中方法 − 较强单模型（BI）", "Test: selected method − better single (BI)")}</text>
  </svg></div><div className="cc-scatter-legend"><span><i style={{ background: PURPLE }} />{t("超过两个单模型", "Beats both models")}</span><span><i style={{ background: GOLD }} />{t("未超过 / 持平", "Below / tied")}</span><span>{points.length} / {pairs.length} {t("个坐标可计算", "coordinates defined")}</span></div>
    <div className="cc-hover-readout" aria-live="polite">{hoveredPoint ? <><strong>{shortModel(hoveredPoint.p.model_a)} + {shortModel(hoveredPoint.p.model_b)}</strong><span>D<sub>type</sub> {score(hoveredPoint.x)} · {t("相对较强单模型", "vs better single")} <b>{score(hoveredPoint.y, 3, true)} BI</b></span></> : t("点击一个点，上方模型能力图会同步更新。", "Select a point to update the ability profile above.")}</div>
  </figure>;
}

function mean(values: Score[]): Score {
  const defined = values.filter(isScore);
  return defined.length ? defined.reduce((total, value) => total + value, 0) / defined.length : null;
}

function GapComparison({ data, view, t }: { data: ComplementarityData; view: View; t: Copy }) {
  const summaries = ABILITY_GAPS.map(gap => studySummary(data, view.dimension, view.coverage, view.cohort, gap, view.method));
  const pairs3 = eligiblePairs(data, view.dimension, view.coverage, view.cohort, 3);
  const pairs5 = eligiblePairs(data, view.dimension, view.coverage, view.cohort, 5);
  const ids3 = new Set(pairs3.map(pair => pair.id));
  const ring = pairs5.filter(pair => !ids3.has(pair.id));
  const ringWhole = ring.map(pair => pairGain(pair, view.method));
  const ringDefined = ringWhole.filter(isScore);
  const ringWins = ringDefined.length ? ringDefined.filter(value => value > 1e-10).length / ringDefined.length : null;
  return <div className="cc-gap-layout">
    <div><h3>{t("同一方法，两个能力门槛", "Same method, two ability limits")}</h3>
      <GainBars t={t} rows={summaries.map((summary, index) => ({
        label: `${t("训练 BI 差", "Train BI gap")} ≤ ${ABILITY_GAPS[index]}`,
        value: summary?.mean_gain_vs_test_best_bi ?? null,
        detail: summary ? `n = ${summary.n} · ${pct(summary.beats_both_rate, 1)} ${t("超过两个模型", "beat both")}` : t("无合格模型对", "No eligible pairs"),
        color: ABILITY_GAPS[index] === view.abilityGap ? PURPLE : B,
      }))} />
      <p className="cc-caption">{t("两行都相对相同测试题目上的较强单模型。≤3 是主敏感性，≤5 是更宽的稳健性检查。", "Both rows use the better single model on identical test targets. Gap ≤3 is the main sensitivity; ≤5 is the wider robustness check.")}</p>
    </div>
    <div className="cc-ring-card"><p className="cc-eyebrow">{t("放宽门槛新增的模型对", "NEWLY ADMITTED RING")}</p><h3>3 &lt; {t("训练 BI 差", "train BI gap")} ≤ 5</h3><div className="cc-ring-number">{ring.length}<span>{t("对", "pairs")}</span></div>
      <dl className="cc-score-list"><div><dt>{t("相对较强单模型的平均收益", "Mean gain vs better single")}</dt><dd>{score(mean(ringWhole), 3, true)} BI</dd></div><div><dt>{t("超过两个模型", "Beats both")}</dt><dd>{pct(ringWins, 1)}</dd></div><div><dt>{t("坐标可计算", "Defined outcomes")}</dt><dd>{ringDefined.length} / {ring.length}</dd></div></dl>
      <p className="cc-caption">{ring.length ? t("只包含门槛从 3 放宽到 5 后新进入的模型对。", "Only pairs newly admitted when the limit is relaxed from 3 to 5.") : t("当前覆盖条件下没有新增模型对。", "No additional pairs enter under the current coverage rule.")}</p>
    </div>
  </div>;
}

function DirectionStability({ data, pairs, view, t }: { data: ComplementarityData; pairs: StudyPair[]; view: View; t: Copy }) {
  const directions = directionSummaries(data, view.dimension, view.coverage, view.cohort, view.abilityGap, view.method).sort((a, b) => a.split.localeCompare(b.split) || a.fold - b.fold);
  const gains = directions.map(row => row.mean_gain_vs_test_best_bi).filter(isScore);
  const positive = gains.filter(value => value > 1e-10).length;
  const meanBeatRate = mean(directions.map(row => row.beats_both_rate));
  const datasetShare = mean(pairs.map(pair => pair.train_origin_dataset_fraction));
  return <div className="cc-stability-layout">
    <div><h3>{t("固定的十个事件方向", "Ten fixed event directions")}</h3><div className="cc-random-strip"><div><strong>{positive} / {gains.length}</strong><span>{t("方向的整体聚合收益为正", "directions with positive whole-test gain")}</span></div><div className="cc-random-dots">{directions.map(row => { const value = row.mean_gain_vs_test_best_bi; return <span key={`${row.split}-${row.fold}`} className={isScore(value) && value > 0 ? "is-positive" : ""} title={`${row.split} · ${row.fold === 0 ? "A→B" : "B→A"}: ${score(value, 3, true)} BI`}>{score(value, 3, true)}</span>; })}</div></div>
      <dl className="cc-score-list cc-stability-list"><div><dt>{t("十个方向的平均收益", "Mean across directions")}</dt><dd>{score(mean(gains), 3, true)} BI</dd></div><div><dt>{t("方向范围", "Direction range")}</dt><dd>[{score(gains.length ? Math.min(...gains) : null)}, {score(gains.length ? Math.max(...gains) : null)}]</dd></div><div><dt>{t("平均超过两个模型比例", "Mean pair-level beat-both rate")}</dt><dd>{pct(meanBeatRate, 1)}</dd></div></dl>
      <p className="cc-caption">{t("这些方向重复使用事件、模型和模型对，因此是稳定性视图，不是十次独立复现。", "These directions reuse events, models and model pairs. They are stability views, not ten independent replications.")}</p>
    </div>
    <div className="cc-weighting-card"><p className="cc-eyebrow">{t("本轮权重口径", "WEIGHTING IN THIS RUN")}</p><div className="cc-weight-number">{pct(datasetShare, 1)}</div><h3>{t("训练权重来自 Dataset 行", "of training weight comes from Dataset rows")}</h3><p>{t("每个共同预测目标权重都是 1/n。Dataset 与 Market 没有各占 50%；仍保留每道题的官方难度修正。", "Every common forecast target receives weight 1/n. Dataset and Market are not forced to 50/50; the official per-target difficulty offsets remain in adjusted Brier and BI.")}</p><p className="cc-inline-caution">{t("因此这轮回答的是实际目标行混合上的表现，而这个混合主要由 Dataset 题目构成。", "This run answers performance on the empirical target-row mixture, which is dominated by Dataset questions.")}</p></div>
  </div>;
}

function Study({ data }: { data: ComplementarityData }) {
  const [view, setView] = useState<View>(initialView), [search, setSearch] = useState("");
  const t: Copy = (_zh, en) => en;
  const pairs = useMemo(() => eligiblePairs(data, view.dimension, view.coverage, view.cohort, view.abilityGap), [data, view.dimension, view.coverage, view.cohort, view.abilityGap]);
  const searchable = useMemo(() => { const needle = search.trim().toLowerCase(); return needle ? pairs.filter(pair => `${pair.model_a} ${pair.model_b}`.toLowerCase().includes(needle)) : pairs; }, [pairs, search]);
  const selected = defaultPair(pairs, view.pair), selectedIndex = searchable.findIndex(pair => pair.id === selected?.id);
  const methodLabel = data.methods.find(method => method.id === view.method)?.label ?? view.method;
  const summary = studySummary(data, view.dimension, view.coverage, view.cohort, view.abilityGap, view.method);

  function change(patch: Partial<View>) {
    const next = { ...view, ...patch }; setView(next);
    const q = new URLSearchParams(window.location.search);
    q.delete("cc_lang"); q.set("cc_dim", next.dimension); q.set("cc_coverage", String(next.coverage)); q.set("cc_cohort", next.cohort); q.set("cc_gap", String(next.abilityGap)); q.set("cc_method", next.method);
    if (next.pair) q.set("cc_pair", next.pair);
    history.replaceState(null, "", `${window.location.pathname}?${q.toString()}#complementarity`);
  }
  function download() {
    const blob = new Blob([csvForPairs(pairs, view.method)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob), link = document.createElement("a"); link.href = url; link.download = `complementarity_gap${view.abilityGap}_${view.dimension}_${view.coverage}_${view.cohort}_${view.method}.csv`; link.click(); URL.revokeObjectURL(url);
  }

  return <section id="complementarity" className="cc-study" lang="en">
    <header className="cc-intro"><div><p className="cc-eyebrow">FORECASTBENCH / COMPLEMENTARITY <span className="cc-study-status">{t("内部事件留出研究", "INTERNAL EVENT-HOLDOUT STUDY")}</span></p><h1>{t("类别互补能找到更好的聚合模型对吗？", "Can category complementarity identify pairs that aggregate well?")}</h1><p>{t("先用训练集筛选整体能力相近、类别强项交叉的模型对，再用现有聚合公式在不同事件上检验。", "Use training data to select similarly skilled pairs with crossed category strengths, then evaluate existing aggregation formulas on different events.")}</p></div></header>
    <div className="cc-study-meta"><span><b>{data.sample.scored_models}</b> {t("个固定模型配置", "exact configurations")}</span><span><b>{data.sample.genuine_scored_predictions.toLocaleString()}</b> {t("条真实预测", "genuine forecasts")}</span><span><b>{data.sample.events.toLocaleString()}</b> {t("个事件簇", "event clusters")}</span><span>{t("Zero-shot · 无额外信息 · 2026-09-01", "Zero-shot · no extra information · 2026-09-01")}</span></div>

    <div className="cc-filter-dock cc-filter-five"><div><span className="cc-field-label">{t("按什么分组", "GROUP QUESTIONS BY")}</span><div className="cc-segments" role="group" aria-label={t("分组维度", "Grouping dimension")}><button aria-pressed={view.dimension === "topic"} onClick={() => { setSearch(""); change({ dimension: "topic" }); }}>{t("事件类型", "Event type")}</button><button aria-pressed={view.dimension === "source"} onClick={() => { setSearch(""); change({ dimension: "source" }); }}>{t("题目来源 / 平台", "Question source / platform")}</button></div></div>
      <label><span className="cc-field-label">{t("训练整体能力差", "TRAIN BI GAP")}</span><select aria-label={t("训练 BI 差门槛", "Train BI gap limit")} value={view.abilityGap} onChange={event => change({ abilityGap: Number(event.target.value) as AbilityGap })}>{ABILITY_GAPS.map(gap => <option key={gap} value={gap}>≤ {gap} · {gap === 3 ? t("主敏感性", "main sensitivity") : t("宽松稳健性", "wider robustness")}</option>)}</select></label>
      <label><span className="cc-field-label">{t("类别覆盖", "CATEGORY COVERAGE")}</span><select aria-label={t("类别覆盖要求", "Category coverage")} value={view.coverage} onChange={event => change({ coverage: Number(event.target.value) })}>{COVERAGES.map(coverage => <option key={coverage} value={coverage}>{pct(coverage)} {t("训练行权重", "training row mass")}</option>)}</select></label>
      <label><span className="cc-field-label">{t("模型对范围", "PAIR COHORT")}</span><select aria-label={t("模型对范围", "Pair cohort")} value={view.cohort} onChange={event => change({ cohort: event.target.value as CohortKind })}><option value="crossing">{t("训练中各有强项", "Crossed training strengths")}</option><option value="eligible">{t("全部合格的近能力组合", "All eligible near-skill pairs")}</option></select></label>
      <label><span className="cc-field-label">{t("聚合方法", "AGGREGATION METHOD")}</span><select aria-label={t("互补实验聚合方法", "Complementarity aggregation method")} value={view.method} onChange={event => change({ method: event.target.value })}>{data.methods.map(method => <option key={method.id} value={method.id}>{method.label}</option>)}</select></label>
    </div>
    <div className="cc-scope-note" data-testid="cc-scope"><strong>{view.abilityGap === 3 ? t("主敏感性", "Main sensitivity") : t("宽松稳健性", "Wider robustness")} · {t("训练 BI 差", "Training BI gap")} ≤ {view.abilityGap}</strong><span>{t("每个共同目标等权（1/n），不做 Dataset／Market 50:50 平衡。只用训练 BI 筛选；测试 BI 差不参与选择。每类至少 30 个训练事件才进入互补性筛选。", "Uniform target weights (1/n); no Dataset/Market 50:50 balancing. Eligibility uses training BI only; test BI gap never enters selection. A category needs at least 30 training events to enter the complementarity screen.")}</span></div>

    <section className="cc-block cc-pair-block"><SectionLabel index="01" label="PAIR EXPLORER" title={t("先看一对模型的类别能力", "Inspect one pair’s category strengths")}><span>{t("固定主事件划分 · 训练 A → 测试 B", "Primary event split · train A → test B")}</span><strong>{pairs.length} {t("个合格模型对", "eligible pairs")}</strong></SectionLabel>
      <div className="cc-pair-picker"><label className="cc-search-label"><span className="cc-field-label">{t("查找模型", "FIND A MODEL")}</span><input type="search" aria-label={t("查找模型对", "Find model pair")} placeholder={t("输入模型名称…", "Search model name…")} value={search} onChange={event => setSearch(event.target.value)} /></label><label className="cc-pair-select"><span className="cc-field-label">{t("选择具体模型对", "SELECT EXACT MODEL PAIR")}</span><select aria-label={t("选择具体模型对", "Select exact model pair")} value={searchable.some(pair => pair.id === selected?.id) ? selected?.id : ""} onChange={event => change({ pair: event.target.value })}><option value="" disabled>{searchable.length ? t("选择一个模型对", "Select a pair") : t("没有匹配名称", "No names match")}</option>{searchable.map(pair => <option key={pair.id} value={pair.id}>{shortModel(pair.model_a)} + {shortModel(pair.model_b)}</option>)}</select></label><div className="cc-pair-step"><button aria-label={t("上一个模型对", "Previous pair")} disabled={selectedIndex <= 0} onClick={() => change({ pair: searchable[selectedIndex - 1].id })}>←</button><button aria-label={t("下一个模型对", "Next pair")} disabled={selectedIndex < 0 || selectedIndex >= searchable.length - 1} onClick={() => change({ pair: searchable[selectedIndex + 1].id })}>→</button></div></div>
      {selected ? <><div className="cc-pair-facts"><div><span>{t("整体训练 BI 差", "Overall train BI gap")}</span><strong>{score(selected.train_gap)}</strong><small>≤ {view.abilityGap}</small></div><div><span>{t("整体测试 BI 差", "Overall test BI gap")}</span><strong>{score(selected.test_gap)}</strong><small>{t("仅诊断，不筛选", "diagnostic only")}</small></div><div><span>{t("有效类别训练行权重", "Supported training row mass")}</span><strong>{pct(selected.train_coverage, 1)}</strong></div><div><span>{t("测试事件", "Test events")}</span><strong>{selected.test_events.toLocaleString()}</strong></div></div><ModelLegend pair={selected} method={methodLabel} t={t} /><div className="cc-pair-layout"><AbilityProfile pair={selected} method={view.method} t={t} /><GainInspector pair={selected} method={view.method} methodLabel={methodLabel} t={t} /></div><div className="cc-pair-footnote"><span className={`cc-transfer ${selected.crossing_persists === true ? "is-preserved" : ""}`}>{selected.crossing_persists === true ? t("两个训练强项在测试同时保持", "Both training specialists retain their advantage") : selected.crossing_persists === false ? t("两个训练强项未同时保持", "The two training strengths do not both persist") : t("双强项复现：支持不足或不适用", "Crossed-strength transfer: unsupported or not applicable")}</span>{selected.id === "44_58" && <span>{t("此组合是说明案例，不是独立确认。", "This pair is an illustration, not independent confirmation.")}</span>}</div></> : <div className="cc-empty">{t("当前条件没有合格模型对。空结果不会替换成 0 或其他模型。", "No eligible pairs under these conditions. Empty results are not replaced by zero or another cohort.")}</div>}
    </section>

    <section className="cc-block"><SectionLabel index="02" label="PRIMARY ENDPOINT" title={t("现有聚合方法能否整体超过两个模型？", "Can an existing aggregation method beat both models overall?")}><button className="cc-text-button" onClick={download}>{t("下载当前模型对 CSV", "Download current pairs CSV")} ↗</button></SectionLabel>
      <div className="cc-cohort-stats cc-cohort-four"><div><span>{methodLabel} {t("相对较强单模型", "vs better test single")}</span><strong>{score(summary?.mean_gain_vs_test_best_bi, 3, true)} <small>BI</small></strong><small>{t("同一批测试目标", "identical test targets")}</small></div><div><span>{t("超过两个单模型", "Beats both models")}</span><strong>{pct(summary?.beats_both_rate, 1)}</strong><small>n = {summary?.n_defined ?? 0}</small></div><div><span>{t("相对训练选中单模型", "Gain vs train-selected single")}</span><strong>{score(summary?.mean_gain_vs_train_selected_bi, 3, true)} <small>BI</small></strong><small>{pct(summary?.beats_train_selected_rate, 1)} {t("为正", "positive")}</small></div><div><span>{t("原始 Brier 降低", "Raw Brier reduction")}</span><strong>{score(summary?.mean_gain_vs_test_best_raw_loss, 4, true)}</strong><small>{t("正值更好", "positive is better")}</small></div></div>
      <PairScatter pairs={pairs} selected={selected} method={view.method} select={id => { setSearch(""); change({ pair: id }); }} t={t} />
      <p className="cc-caption">{t("每个点是一对固定模型。X 只用训练题目；Y 使用不同事件的测试题目，并直接比较相同测试目标上较强的单模型。点击点可联动上方能力图。", "Each point is one exact model pair. X uses training questions only; Y uses different test events and compares directly with the better single model on identical test targets. Select a point to update the profile above.")}</p>
      <details className="cc-details"><summary>{t("对比全部聚合方法", "Compare all aggregation methods")}</summary><GainBars t={t} rows={data.methods.map(method => { const row = studySummary(data, view.dimension, view.coverage, view.cohort, view.abilityGap, method.id); return { label: method.label, value: row?.mean_gain_vs_test_best_bi ?? null, detail: method.id === "cf_directional" ? t("训练折拟合", "train-fitted") : t("固定公式", "fixed formula") }; })} /><p className="cc-caption">{t("所有行均是相同队列中相对测试较强单模型的平均 BI。五种现有聚合公式没有更改，类别标签不进入公式。", "Every row is the mean BI gain over the better test single in the same cohort. The five existing formulas are unchanged, and category labels do not enter them.")}</p></details>
    </section>

    <section className="cc-block"><SectionLabel index="03" label="ABILITY-GAP SENSITIVITY" title={t("把能力差门槛从 3 放宽到 5 会怎样？", "What changes when the ability gap widens from 3 to 5?")} /><GapComparison data={data} view={view} t={t} /></section>
    <section className="cc-block"><SectionLabel index="04" label="STABILITY & WEIGHTING" title={t("结果跨方向稳定吗，实际在给什么样本加权？", "Is the result stable, and what sample receives the weight?")} /><DirectionStability data={data} pairs={pairs} view={view} t={t} /></section>

    <section className="cc-block cc-methods-block"><SectionLabel index="05" label="METHODS & EVIDENCE" title={t("这个实验能支持什么论点？", "What can this experiment support?")} />
      <div className="cc-claim"><p>{t("在这份内部事件留出档案中，先控制训练整体能力接近、再选择类别强项交叉的模型对，现有 Directional CF 在事件类型和题目来源两种分组下平均都超过两个单模型。", "In this internal event-holdout archive, after controlling for similar training skill and selecting pairs with crossed category strengths, the existing Directional CF beats both single models on average under both grouping schemes.")}</p><span>{t("类别只用于筛选与解释模型对；它不进入聚合权重。更谨慎的结论是这种筛选与较好的聚合结果相关，而不是类别互补已经被证明具有普遍因果效应。样本主要由 Dataset 题目构成，历史档案也被反复研究。", "Categories only select and describe pairs; they do not enter aggregation weights. The careful conclusion is that this screen is associated with stronger aggregation, not that semantic category complementarity has a proven universal causal effect. The sample is Dataset-dominated, and the archive has been studied repeatedly.")}</span></div>
      <details className="cc-details" open><summary>{t("实验设计与主要终点", "Design and primary endpoint")}</summary><div className="cc-definition"><p>D<sub>type</sub> = min(R<sub>A</sub>, R<sub>B</sub>) − Σ<sub>g</sub> π<sub>g</sub> min(R<sub>A,g</sub>, R<sub>B,g</sub>)</p><span>{t("R 是训练 raw Brier risk，π 是类别在相同训练目标中的行权重；图中再除以两模型的平均训练 raw Brier。数值大表示比较优势分布在不同类别，只从训练集计算。", "R is training raw Brier risk and π is category row mass on the same training targets; the plotted value is divided by the models’ mean training raw Brier. Larger values mean comparative advantages are distributed across categories. Training data only.")}</span></div><ul><li>{t("94 个固定 plain zero-shot、无额外信息配置；填补或修复的预测仍然排除。", "Ninety-four exact plain-zero-shot, no-extra-information configurations; imputed or repaired predictions remain excluded.")}</li><li>{t("五个固定事件簇划分、双向评估；主视图为 20260910 的 A→B。训练和测试事件不重叠。", "Five fixed event-cluster splits in both directions; the primary view is 20260910 A→B. Train and test events do not overlap.")}</li><li>{t("训练 BI 差分别限制在 ≤3 和 ≤5；测试 BI 差不参与模型对选择。交叉强项要求 A、B 各自在至少一个类别领先 1 BI。", "Training BI gaps are limited separately to ≤3 and ≤5; test BI gaps never select pairs. Crossed strengths require A and B each to lead by at least 1 BI in a different training category.")}</li><li>{t("每个共同目标权重为 1/n，不平衡 Dataset／Market；官方逐题难度修正继续保留。", "Each common target receives weight 1/n, without Dataset/Market balancing; official per-target difficulty adjustments remain.")}</li><li>{t("每半至少 100 个事件；只有至少 30 个训练事件的类别才进入互补性指标与交叉强项筛选。", "Each half needs at least 100 events. Only categories with at least 30 training events enter the complementarity metric and crossed-strength screen.")}</li><li><strong>{t("类别不参与聚合。", "Categories never enter aggregation.")}</strong> {t("没有类别路由、类别权重或收缩。五种可选方法是 Simple mean、Log-odds mean、EC（w=0.56）、Piecewise odds 和 Directional CF，计算保持不变。", "There is no category routing, category weight, or shrinkage. The five unchanged selectable methods are Simple mean, Log-odds mean, EC (w = 0.56), Piecewise odds, and Directional CF.")}</li><li>{t("Directional CF 只在整个训练折上按 partner 高于或低于 anchor 拟合两个 clipped C/D 权重，并原样用于测试。", "Directional CF fits two clipped C/D weights on the whole training fold according to whether the partner is above or below the anchor, then applies them unchanged on test.")}</li><li>{t("首要终点是所选聚合 BI 减去相同测试目标上较强单模型 BI。Best single 依赖测试结果，只作事后参照，不是可选聚合方法。", "The primary endpoint is selected-method BI minus the better single-model BI on identical test targets. Best Single uses test outcomes and remains a hindsight reference, not a selectable aggregation method.")}</li></ul></details>
      <details className="cc-details"><summary>{t("独立核对与限制", "Independent checks and limitations")}</summary><p>{t(`独立实现重算了 ${data.audit.sampled_rows} 条主结果；最大绝对误差 ${data.audit.max_absolute_error.toExponential(2)}。训练／测试事件不重叠，≤3 队列是 ≤5 队列的严格子集。`, `An independent implementation reconstructed ${data.audit.sampled_rows} primary rows; maximum absolute error was ${data.audit.max_absolute_error.toExponential(2)}. Train/test events are disjoint, and every gap-3 cohort is an exact subset of gap-5.`)}</p><p>{t("十个方向重复使用事件、模型和重叠模型对，不能视为十次独立复现。结果也没有覆盖此前所有模型、门槛、指标和档案探索。", "The ten directions reuse events, models, and overlapping model pairs, so they are not ten independent replications. The result also does not account for all earlier model, threshold, metric, and archive exploration.")}</p><p>{t("下一步应冻结模型、类别、阈值和 Directional CF，并在真正未研究的后续事件上确认。", "The next step is to freeze models, categories, thresholds, and Directional CF, then confirm on genuinely unstudied later events.")}</p></details>
      <div className="cc-downloads"><a href={`${COMPLEMENTARITY_PATH}REPORT.md`} download>{t("完整研究报告", "Full research report")} ↗</a><a href={`${COMPLEMENTARITY_PATH}PROTOCOL.md`} download>{t("冻结实验方案", "Study protocol")} ↗</a><a href={`${COMPLEMENTARITY_PATH}requested_primary_results.csv`} download>{t("主结果表 CSV", "Primary results CSV")} ↗</a><a href={`${COMPLEMENTARITY_PATH}primary-pairs.csv`} download>{t("全部主折模型对 CSV", "All primary pair views CSV")} ↗</a><a href={`${COMPLEMENTARITY_PATH}independent_audit.json`} download>{t("独立数值核对", "Independent numeric audit")} ↗</a><a href={`${COMPLEMENTARITY_PATH}manifest.json`}>{t("来源与文件哈希", "Provenance & hashes")} ↗</a></div>
      <p className="cc-caption">{t("派生自 ForecastBench · CC BY-SA 4.0 · 页面数据由冻结实验输出导出，未在浏览器中重新拟合。", "Derived from ForecastBench · CC BY-SA 4.0 · Page data are exported from frozen experiment outputs and are not refitted in the browser.")}</p>
    </section>
  </section>;
}

export default function ComplementarityExplorer() {
  const [data, setData] = useState<ComplementarityData | null>(null), [error, setError] = useState(""), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    let changed = false;
    if (query.has("cc_lang")) {
      query.delete("cc_lang");
      changed = true;
    }
    if (query.has("cc_method") && !METHOD_SET.has(query.get("cc_method") ?? "")) {
      query.set("cc_method", "cf_directional");
      changed = true;
    }
    if (changed) {
      history.replaceState(null, "", `${window.location.pathname}${query.size ? `?${query.toString()}` : ""}${window.location.hash}`);
    }
  }, []);
  useEffect(() => { const controller = new AbortController(); setError(""); loadComplementarity(controller.signal).then(setData).catch(error => { if (!controller.signal.aborted) setError(String(error.message ?? error)); }); return () => controller.abort(); }, [attempt]);
  if (!data) return <section id="complementarity" className="cc-study cc-loading" lang="en" aria-live="polite" aria-busy={!error}><p className="cc-eyebrow">FORECASTBENCH / COMPLEMENTARITY</p><h1>{error ? "Results unavailable" : "Preparing the study"}</h1><p>{error || "Loading audited model pairs, category strengths and aggregation results…"}</p>{error && <button className="research-button" onClick={() => setAttempt(attempt => attempt + 1)}>Try again</button>}</section>;
  return <Study data={data} />;
}
