import type { AppData, Audit, EventTypeData, Manifest, Model, Taxonomy } from "../types/data";

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
