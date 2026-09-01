import type {
  OverallGap,
  TopicGap,
  TopicSupport,
  WithinTopicFocalData,
  WithinTopicMetric,
  WithinTopicOutcome,
  WithinTopicPair,
  WithinTopicStudy,
  WithinTopicSummary,
} from "../types/withinTopicComplementarity";
import type { PairScope, Score } from "../types/complementarity";

export const WITHIN_TOPIC_PATH = `${import.meta.env.BASE_URL}data/within-topic-complementarity/`;
export const WITHIN_TOPIC_METHODS = [
  "simple_mean", "log_odds_mean", "ec_w0_56", "piecewise_odds", "cf_directional",
] as const;
export const WITHIN_TOPIC_TOPICS = [
  "health", "politics", "sports", "finance", "technology",
  "climate_weather", "entertainment_culture",
] as const;

export const isFiniteScore = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

export function withinTopicMetric(pair: WithinTopicPair, metric: WithinTopicMetric): Score {
  return metric === "normalized_pog" ? pair.train_normalized_pog : pair.train_adjusted_pog;
}

export function withinTopicGain(pair: WithinTopicPair, method: string, outcome: WithinTopicOutcome): Score {
  const aggregation = pair.methods[method]?.[outcome === "topic" ? "topic_bi" : "overall_bi"];
  const first = outcome === "topic" ? pair.test_topic_bi_a : pair.test_bi_a;
  const second = outcome === "topic" ? pair.test_topic_bi_b : pair.test_bi_b;
  return isFiniteScore(aggregation) && isFiniteScore(first) && isFiniteScore(second)
    ? aggregation - Math.max(first, second)
    : null;
}

export function pairInScope(pair: WithinTopicPair, scope: PairScope): boolean {
  return scope === "all"
    || (scope === "different_model_version" && !pair.same_model_version)
    || (scope === "matched_conditions" && pair.same_prompt && pair.same_information);
}

export function trainingEligibleWithinTopicPairs(
  pairs: WithinTopicPair[],
  topic: string,
  overallGap: OverallGap,
  topicGap: TopicGap,
  support: TopicSupport,
  scope: PairScope,
  metric: WithinTopicMetric,
): WithinTopicPair[] {
  return pairs.filter(pair => pair.topic === topic
    && pair.train_overall_gap <= overallGap + 1e-12
    && pair.train_topic_gap <= topicGap + 1e-12
    && pair.train_topic_events >= support
    && pairInScope(pair, scope)
    && isFiniteScore(withinTopicMetric(pair, metric)));
}

export function findWithinTopicSummary(
  study: WithinTopicStudy,
  scope: PairScope,
  overallGap: OverallGap,
  topicGap: TopicGap,
  support: TopicSupport,
  method: string,
  outcome: WithinTopicOutcome,
  metric: WithinTopicMetric,
): WithinTopicSummary | undefined {
  return study.summaries.find(row => row.pair_scope === scope
    && row.overall_gap === overallGap
    && row.topic_gap === topicGap
    && row.support === support
    && row.method === method
    && row.outcome === outcome
    && row.metric === metric);
}

function validateStudy(data: WithinTopicStudy): void {
  if (data.schema_version !== 1
    || data.weighting !== "uniform_rows_within_topic"
    || data.event_type_taxonomy !== "forecastbench-seven-domain-v1.0.0"
    || data.audit?.status !== "PASS"
    || data.audit?.event_disjointness !== "PASS"
    || data.audit?.implementation_independent !== true
    || data.audit?.train_only_selection !== true
    || data.audit?.no_test_gap_filter !== true
    || data.sample?.configurations !== 313
    || data.topics?.map(item => item.id).join("|") !== WITHIN_TOPIC_TOPICS.join("|")
    || data.methods?.map(item => item.id).join("|") !== WITHIN_TOPIC_METHODS.join("|")
    || !Array.isArray(data.configurations)
    || !Array.isArray(data.summaries)
    || data.validation?.status !== "PASS"
    || !Array.isArray(data.validation?.validations)
    || !data.focal_files) {
    throw new Error("The within-topic results do not match the expected audited study.");
  }
}

export async function loadWithinTopicStudy(signal?: AbortSignal): Promise<WithinTopicStudy> {
  const response = await fetch(`${WITHIN_TOPIC_PATH}study.json`, { signal });
  if (!response.ok) throw new Error(`Within-topic results could not be loaded (${response.status}).`);
  const data = await response.json() as WithinTopicStudy;
  validateStudy(data);
  return data;
}

const focalCache = new Map<string, WithinTopicFocalData>();

export async function loadWithinTopicFocal(
  study: WithinTopicStudy,
  focal: string,
  signal?: AbortSignal,
): Promise<WithinTopicFocalData> {
  const cached = focalCache.get(focal);
  if (cached) return cached;
  const file = study.focal_files[focal];
  if (!file) throw new Error("The selected exact configuration is outside the within-topic release.");
  const response = await fetch(`${WITHIN_TOPIC_PATH}${file}`, { signal });
  if (!response.ok) throw new Error(`Selected-model within-topic results could not be loaded (${response.status}).`);
  const data = await response.json() as WithinTopicFocalData;
  if (data.schema_version !== 1 || data.focal !== focal || !Array.isArray(data.pairs)) {
    throw new Error("The selected-model within-topic result shard is incompatible with this study.");
  }
  focalCache.set(focal, data);
  return data;
}
