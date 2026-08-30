export interface ExistingAggregationLink {
  page: "upper-left-pairs" | "fixed-focal-no-freeze";
  label: string;
  params: { upper_left_base?: string; upper_left_view?: "crossfit" | "fixed"; upper_left_min_directions?: "1"; nofreeze_base?: string };
  scope: "polymarket_only" | "all_events";
  evaluation: "cross_fit" | "full_sample";
  methods: string[];
}

export interface ExistingAggregationLinkIndex {
  schema_version: 1;
  entries: Record<string, ExistingAggregationLink[]>;
}

export function buildAggregationLinks(overview: unknown, upperLeft: unknown, fixedFocal: unknown): ExistingAggregationLinkIndex;
export function buildPublishedAggregationLinks(): ExistingAggregationLinkIndex;
