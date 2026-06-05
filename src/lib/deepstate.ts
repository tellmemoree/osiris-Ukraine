import { stealthFetch } from '@/lib/stealthFetch';

export interface GeoJSONFeatureCollection {
  type?: string;
  features?: unknown[];
  map?: { features?: unknown[]; [key: string]: unknown };
  [key: string]: unknown;
}

export function extractFeatures(d: GeoJSONFeatureCollection | undefined): unknown[] {
  if (Array.isArray(d?.map?.features)) return d.map.features as unknown[];
  if (Array.isArray(d?.features)) return d.features;
  return [];
}

export async function fetchDeepState(): Promise<GeoJSONFeatureCollection> {
  const res = await stealthFetch('https://deepstatemap.live/api/history/last', {
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`DeepState returned ${res.status}`);
  return res.json();
}
