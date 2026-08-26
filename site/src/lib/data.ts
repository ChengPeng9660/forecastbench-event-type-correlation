import type {
  AppData,
  Audit,
  CrossTypeData,
  CrossTypeManifest,
  CrossTypeSummary,
  EventTypeData,
  FocalGainData,
  GlobalBaselineData,
  GlobalBaselineManifest,
  GlobalBaselineSummary,
  GlobalPartnerProfileRow,
  GlobalPartnerProfiles,
  GlobalPairMatrixCompact,
  GlobalPairMatrixRow,
  Manifest,
  Model,
  PairAggregationData,
  Taxonomy,
} from "../types/data";

const dataUrl = (path: string) => `${import.meta.env.BASE_URL}data/${path}`;

async function loadJson<T>(path: string): Promise<T> {
  const response = await fetch(dataUrl(path));
  if (!response.ok) throw new Error(`Unable to load ${path} (${response.status})`);
  return response.json() as Promise<T>;
}

export async function loadAppData(): Promise<AppData> {
  const [manifest, models, taxonomy, audit] = await Promise.all([
    loadJson<Manifest>("manifest.json"),
    loadJson<Model[]>("models.json"),
    loadJson<Taxonomy>("taxonomy.json"),
    loadJson<Audit>("audit.json"),
  ]);
  return { manifest, models, taxonomy, audit };
}

export function loadEventType(file: string): Promise<EventTypeData> {
  return loadJson<EventTypeData>(file);
}

export function loadFocalGainData(): Promise<FocalGainData> {
  return loadJson<FocalGainData>("focal-gain/gpt-4-1-2025-04-14.json");
}

export function loadPairAggregationData(): Promise<PairAggregationData> {
  return loadJson<PairAggregationData>("pair-aggregation/all-six-family-pairs.json");
}

export function crossTypeAssetUrl(path: string): string {
  return dataUrl(path);
}

export async function loadCrossTypeData(): Promise<CrossTypeData | null> {
  const manifestResponse = await fetch(dataUrl("cross-type/manifest.json"));
  if (manifestResponse.status === 404) return null;
  if (!manifestResponse.ok) {
    throw new Error(`Unable to load cross-type/manifest.json (${manifestResponse.status})`);
  }
  const manifest = await manifestResponse.json() as CrossTypeManifest;
  const summary = await loadJson<CrossTypeSummary>(manifest.summary_json);
  if (manifest.schema_version !== summary.schema_version) {
    throw new Error(`Cross-type schema mismatch (${manifest.schema_version} vs ${summary.schema_version})`);
  }
  return { manifest, summary };
}

export function globalBaselineAssetUrl(path: string): string {
  return dataUrl(path);
}

export async function loadGlobalBaselineData(): Promise<GlobalBaselineData | null> {
  const manifestResponse = await fetch(dataUrl("global-baseline/manifest.json"));
  if (manifestResponse.status === 404) return null;
  if (!manifestResponse.ok) {
    throw new Error(`Unable to load global-baseline/manifest.json (${manifestResponse.status})`);
  }
  const manifest = await manifestResponse.json() as GlobalBaselineManifest;
  const summary = await loadJson<GlobalBaselineSummary>(manifest.summary_json);
  if (manifest.schema_version !== summary.schema_version) {
    throw new Error(`Global-baseline schema mismatch (${manifest.schema_version} vs ${summary.schema_version})`);
  }
  return { manifest, summary };
}

export async function loadGlobalPartnerProfiles(path: string, expectedSchemaVersion?: string, expectedModelId?: string): Promise<GlobalPartnerProfileRow[]> {
  const payload = await loadJson<GlobalPartnerProfiles>(path);
  if (expectedSchemaVersion && payload.schema_version !== expectedSchemaVersion) {
    throw new Error(`Global partner-profile schema mismatch (${expectedSchemaVersion} vs ${payload.schema_version})`);
  }
  if (expectedModelId && payload.focal_model_id !== expectedModelId) {
    throw new Error(`Global partner-profile model mismatch (${expectedModelId} vs ${payload.focal_model_id})`);
  }
  if (!Array.isArray(payload.profiles)) throw new Error("Global partner-profile payload is malformed");
  if (expectedModelId && payload.profiles.some((row) => row.focal_model_id !== expectedModelId)) {
    throw new Error(`Global partner-profile rows do not belong to ${expectedModelId}`);
  }
  return payload.profiles;
}

export async function loadGlobalPairMatrix(path: string, expectedSchemaVersion?: string): Promise<GlobalPairMatrixCompact> {
  const payload = await loadJson<GlobalPairMatrixCompact>(path);
  if (expectedSchemaVersion && payload.schema_version !== expectedSchemaVersion) {
    throw new Error(`Global pair-matrix schema mismatch (${expectedSchemaVersion} vs ${payload.schema_version})`);
  }
  if (!Array.isArray(payload.fields) || !Array.isArray(payload.pairs)) {
    throw new Error("Global pair-matrix payload is malformed");
  }
  if (payload.pairs.some((row) => row.length !== payload.fields.length)) {
    throw new Error("Global pair-matrix row width does not match its field contract");
  }
  return payload;
}

export function decodeGlobalPairMatrix(payload: GlobalPairMatrixCompact): GlobalPairMatrixRow[] {
  return payload.pairs.map((values) => Object.fromEntries(
    payload.fields.map((field, index) => [field, values[index]]),
  ) as unknown as GlobalPairMatrixRow);
}
