import { describe, expect, it } from "vitest";
import {
  trainingEligibleWithinTopicPairs,
  withinTopicGain,
  withinTopicMetric,
} from "../src/lib/withinTopicComplementarity";
import type { WithinTopicPair } from "../src/types/withinTopicComplementarity";

function pair(overrides: Partial<WithinTopicPair> = {}): WithinTopicPair {
  return {
    id: "wt-one", topic: "finance", model_a: "A", model_b: "B",
    train_overall_events: 100, test_overall_events: 100, train_topic_events: 40, test_topic_events: 40,
    train_topic_rows: 50, test_topic_rows: 50, train_overall_gap: 2, train_mean_bi: 70,
    train_topic_gap: .5, train_bi_a: 70, train_bi_b: 69, train_topic_bi_a: 68,
    train_topic_bi_b: 67.5, test_bi_a: 71, test_bi_b: 70, test_topic_bi_a: 65,
    test_topic_bi_b: 64, test_topic_support_ok: true, train_adjusted_pog: .01,
    train_normalized_pog: .08, train_a_rescue: .01, train_b_rescue: .02,
    train_a_win_share: .45, train_b_win_share: .5, train_tie_share: .05,
    train_mean_raw_loss: .125, alpha_up: .4, alpha_down: .6,
    train_origin_dataset_fraction: .5, same_provider: false, same_model_version: false,
    same_prompt: true, same_information: true,
    methods: { cf_directional: { topic_bi: 66, overall_bi: 71.5 } },
    ...overrides,
  };
}

describe("within-topic POG screen", () => {
  it("requires both overall and topic ability controls plus training support", () => {
    const rows = [
      pair(),
      pair({ id: "overall-fail", train_overall_gap: 3.1 }),
      pair({ id: "topic-fail", train_topic_gap: 1.1 }),
      pair({ id: "support-fail", train_topic_events: 29 }),
    ];
    expect(trainingEligibleWithinTopicPairs(rows, "finance", 3, 1, 30, "all", "normalized_pog").map(row => row.id)).toEqual(["wt-one"]);
  });

  it("keeps normalized and adjusted POG distinct and compares aggregation with the better single", () => {
    const row = pair();
    expect(withinTopicMetric(row, "normalized_pog")).toBe(.08);
    expect(withinTopicMetric(row, "adjusted_pog")).toBe(.01);
    expect(withinTopicGain(row, "cf_directional", "topic")).toBe(1);
    expect(withinTopicGain(row, "cf_directional", "overall")).toBe(.5);
  });

  it("uses shape-independent configuration scope controls", () => {
    const sameVersion = pair({ id: "same", same_model_version: true });
    const differentVersion = pair({ id: "different", same_model_version: false, same_prompt: false });
    expect(trainingEligibleWithinTopicPairs([sameVersion, differentVersion], "finance", 3, 1, 30, "different_model_version", "normalized_pog").map(row => row.id)).toEqual(["different"]);
    expect(trainingEligibleWithinTopicPairs([sameVersion, differentVersion], "finance", 3, 1, 30, "matched_conditions", "normalized_pog").map(row => row.id)).toEqual(["same"]);
  });
});
