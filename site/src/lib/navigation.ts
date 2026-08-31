export const RESEARCH_GROUPS = [
  {
    id: "diversity", label: "Diversity", title: "Explore model diversity.",
    description: "See where models agree, where they differ, and how those relationships change across topics.",
    sections: [
      { id: "matrix", label: "Event atlas" },
      { id: "global", label: "Global view" },
      { id: "ranking", label: "Pair rankings" },
      { id: "model-view", label: "Model profiles" },
      { id: "stability", label: "Topic stability" },
    ],
  },
  {
    id: "aggregation", label: "Aggregation", title: "Find better combinations.",
    description: "Fix a model, vary its partner, and compare aggregation methods on held-out events.",
    sections: [
      { id: "gain", label: "Model pairs" },
      { id: "complementarity", label: "Category complementarity" },
      { id: "fixed-focal-no-freeze", label: "Without market information" },
      { id: "without-freeze-base", label: "Information exposure" },
    ],
  },
  {
    id: "markets", label: "Markets", title: "Models meet the market.",
    description: "Compare forecasts with Polymarket, then explore when combining them helps.",
    sections: [
      { id: "market-performance", label: "Model performance" },
      { id: "polymarket-aggregation", label: "Market + model" },
      { id: "freeze-correlation", label: "Market-informed models" },
      { id: "upper-left-pairs", label: "Selected model pairs" },
    ],
  },
  {
    id: "methods", label: "Methods", title: "Open methods. Traceable results.",
    description: "Definitions, evaluation design, data provenance, and the checks behind every view.",
    sections: [
      { id: "methods", label: "Methodology" },
      { id: "audit", label: "Data & audit" },
    ],
  },
] as const;

export type ResearchSection = typeof RESEARCH_GROUPS[number]["sections"][number]["id"];
export type ResearchPage = "overview" | ResearchSection;

const pages = new Set<string>(["overview", ...RESEARCH_GROUPS.flatMap((group) => group.sections.map((section) => section.id))]);

/** Legacy section hashes remain shareable, including links created before the redesign. */
export function researchPageFromHash(hash: string): ResearchPage {
  const id = hash.replace(/^#/, "");
  return pages.has(id) ? id as ResearchPage : "overview";
}

export function researchGroupFor(page: ResearchPage) {
  return RESEARCH_GROUPS.find((group) => group.sections.some((section) => section.id === page));
}

export function usesAtlasFilters(page: ResearchPage): boolean {
  return page === "matrix" || page === "ranking" || page === "model-view";
}
