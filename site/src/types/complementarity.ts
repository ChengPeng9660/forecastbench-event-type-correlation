export type Dimension = "topic" | "source";
export type CohortKind = "crossing" | "eligible";
export type Language = "zh" | "en";
export type Score = number | null;
export interface StudyMethod { id: string; label: string; kind: "original" | "research" | "hindsight" }
export interface CategoryProfile {
  group: string; train_mass: number; test_mass: Score; train_events: number; test_events: number;
  train_bi_a: Score; train_bi_b: Score; test_bi_a: Score; test_bi_b: Score;
  test_support_ok: boolean; methods: Record<string, Score>;
}
export interface StudyPair {
  id: string; dimension: Dimension; model_a: string; model_b: string;
  train_events: number; test_events: number; train_rows: number; test_rows: number;
  train_gap: number; test_gap: Score; train_bi_a: Score; train_bi_b: Score; test_bi_a: Score; test_bi_b: Score;
  train_groups: Score; train_coverage: Score; train_between_norm: Score; train_between: Score;
  train_within: Score; train_total: Score; train_between_share: Score; crossing: boolean | null;
  crossing_persists: boolean | null; complete_test_profile: boolean | null; train_profile_bi_defined: boolean | null;
  group_a: string | null; group_b: string | null; cross_provider: boolean;
  methods: Record<string, Score>; profiles: CategoryProfile[];
}
export interface MethodSummary {
  n_bi: number; gain_best_bi: Score; gain_trainbest_bi: Score; gain_best_loss: Score;
  positive_rate: Score; n_preservation: number; preservation_rate: Score;
}
export interface CohortSummary {
  split: string; fold: number; dimension: Dimension; threshold: number; cohort: CohortKind;
  n: number; n_scope: number; n_complete_profile: number;
  train_between_mean: Score; train_total_mean: Score; between_share_of_mean_pog: Score;
  test_between_potential: Score; test_misselection_regret: Score; scope_router_gain: Score;
  crossing_persistence: Score; n_crossing_persistence: number; train_coverage_mean: Score; test_coverage_mean: Score;
  type_increment_mean: Score;
  methods: Record<string, MethodSummary>;
}
export interface MatchedResult {
  dimension: Dimension; coverage_threshold: number; triplets: number;
  estimate: Score; ci_low: Score; ci_high: Score;
}
export interface LabelResult {
  dimension: Dimension; cohort: "all_eligible" | "train_crossing"; coverage_threshold: number;
  pairs: number; permutations: number; actual_bi: Score; control_bi: Score; actual_minus_control_bi: Score;
  control_train_changed_event_fraction: Score; control_test_changed_event_fraction: Score;
}
export interface StudyInterval {
  dimension: Dimension; threshold: number; cohort: CohortKind; outcome: string; n: number;
  mean: Score; ci_low: Score; ci_high: Score;
}
export interface ComplementarityData {
  schema_version: 1; study: string; date: string; primary_split: string; primary_fold: number;
  models: string[]; methods: StudyMethod[]; pairs: StudyPair[]; cohorts: CohortSummary[];
  matched: MatchedResult[]; labels: LabelResult[]; intervals: StudyInterval[];
  sample: { scored_models: number; genuine_scored_predictions: number; targets: number; events: number; dates: string[] };
  audit: { status: string; numeric_checks: number; max_absolute_error: number; implementation_tests: number };
  provenance: Record<string, string>;
}
