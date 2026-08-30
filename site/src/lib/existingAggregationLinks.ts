import payload from "../data/existingAggregationLinks.json";

export interface ExistingAggregationLink {
  page: "upper-left-pairs" | "fixed-focal-no-freeze";
  label: string;
  params: Partial<Record<"upper_left_base" | "upper_left_view" | "upper_left_min_directions" | "nofreeze_base", string>>;
  scope: "polymarket_only" | "all_events";
  evaluation: "cross_fit" | "full_sample";
  methods: string[];
}

const index = payload as { schema_version: number; entries: Record<string, ExistingAggregationLink[]> };

export function existingLinksForConfiguration(exactConfiguration: string): ExistingAggregationLink[] {
  return index.entries[exactConfiguration] ?? [];
}

export function existingAggregationHref(link: ExistingAggregationLink): string {
  const params = new URLSearchParams(window.location.search);
  for (const [key, value] of Object.entries(link.params)) {
    if (value !== undefined) params.set(key, value);
  }
  return `${window.location.pathname}?${params.toString()}#${link.page}`;
}
