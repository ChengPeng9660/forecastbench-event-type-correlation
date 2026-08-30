/** Index already-published pair results. This script never computes an experiment. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const siteRoot = resolve(dirname(scriptPath), "..");
const outputPath = join(siteRoot, "src/data/existingAggregationLinks.json");

export function buildAggregationLinks(overview, upperLeft, fixedFocal) {
  const exactNames = new Set(overview.points.map((point) => point.exact_configuration));
  if (exactNames.size !== overview.points.length) throw new Error("Duplicate exact overview configuration");
  const entries = new Map();
  const add = (name, link) => {
    if (!exactNames.has(name)) return;
    if (!entries.has(name)) entries.set(name, []);
    entries.get(name).push(link);
  };

  // Row membership, not catalog membership, proves that a result exists.
  const upperMethods = upperLeft.methods.map((method) => method.id);
  for (const view of ["crossfit", "fixed"]) {
    const actualMethods = new Map();
    for (const row of upperLeft[view].rows) {
      if (view === "fixed" ? !(row.n_pair > 0) : !(row.evaluation_count > 0)) continue;
      if (!upperMethods.includes(row.method)) throw new Error(`Undeclared upper-left method: ${row.method}`);
      for (const name of [row.model_a, row.model_b]) {
        if (!actualMethods.has(name)) actualMethods.set(name, new Set());
        actualMethods.get(name).add(row.method);
      }
    }
    for (const [name, methods] of actualMethods) {
      add(name, {
        page: "upper-left-pairs",
        label: view === "crossfit" ? "Open existing cross-fit pair results" : "Open existing fixed-pair results",
        params: { upper_left_base: name, upper_left_view: view,
          ...(view === "crossfit" ? { upper_left_min_directions: "1" } : {}) },
        scope: "polymarket_only",
        evaluation: view === "crossfit" ? "cross_fit" : "full_sample",
        methods: upperMethods.filter((method) => methods.has(method)),
      });
    }
  }

  const fixedMethods = Object.keys(fixedFocal.evaluation.methods);
  const actualMethodsByBase = new Map();
  for (const point of fixedFocal.points) {
    if (!(point.combined.test_target_cells > 0)) continue;
    if (!actualMethodsByBase.has(point.base_model)) actualMethodsByBase.set(point.base_model, new Set());
    for (const method of Object.keys(point.combined.aggregation)) {
      if (!fixedMethods.includes(method)) throw new Error(`Undeclared fixed-focal method: ${method}`);
      actualMethodsByBase.get(point.base_model).add(method);
    }
  }
  for (const [version, configurations] of Object.entries(fixedFocal.audit.model_configurations)) {
    // A canonical model can only be routed back to an exact configuration when
    // the published audit proves one configuration. Never infer prompt/alias.
    if (configurations.length !== 1 || !actualMethodsByBase.has(version)) continue;
    const configuration = configurations[0];
    const exact = configuration === "" ? version : `${version} (${configuration})`;
    const methods = actualMethodsByBase.get(version);
    add(exact, {
      page: "fixed-focal-no-freeze",
      label: "Open existing fixed-base cross-fit results",
      params: { nofreeze_base: version },
      scope: "all_events",
      evaluation: "cross_fit",
      methods: fixedMethods.filter((method) => methods.has(method)),
    });
  }

  return {
    schema_version: 1,
    entries: Object.fromEntries([...entries.keys()].sort().map((name) => [name, entries.get(name)])),
  };
}

export function buildPublishedAggregationLinks() {
  const read = (path) => JSON.parse(readFileSync(join(siteRoot, "public/data", path), "utf8"));
  return buildAggregationLinks(
    read("polymarket-aggregation/market-diversity-performance.json"),
    read("pair-aggregation/upper-left-model-pairs.json"),
    read("pair-aggregation/fixed-focal-without-freeze.json"),
  );
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  const args = process.argv.slice(2);
  if (args.some((arg) => !["--check", "--stdout"].includes(arg))) throw new Error("Usage: node scripts/build-aggregation-links.mjs [--check | --stdout]");
  const result = buildPublishedAggregationLinks();
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  if (args.includes("--check")) {
    if (readFileSync(outputPath, "utf8") !== serialized) throw new Error("Existing aggregation links are stale; run node scripts/build-aggregation-links.mjs");
    console.log("Existing aggregation links are current.");
  } else if (args.includes("--stdout")) {
    process.stdout.write(serialized);
  } else {
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, serialized, "utf8");
    console.log(JSON.stringify({ configurations: Object.keys(result.entries).length, links: Object.values(result.entries).reduce((count, links) => count + links.length, 0), output: outputPath }));
  }
}
