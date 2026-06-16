import { stealthFetch } from '@/lib/stealthFetch';

export interface GeoJSONFeatureCollection {
  type?: string;
  features?: unknown[];
  map?: { features?: unknown[]; [key: string]: unknown };
  [key: string]: unknown;
}

// Signed area via shoelace formula. Positive = CCW (RFC 7946 exterior ring).
function ringSignedArea(ring: number[][]): number {
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    area += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  }
  return area / 2;
}

function enforceWinding(ring: number[][], mustBeCCW: boolean): number[][] {
  const isCCW = ringSignedArea(ring) > 0;
  return isCCW === mustBeCCW ? ring : [...ring].reverse();
}

// Enforce RFC 7946 winding on Polygon/MultiPolygon features.
// MapLibre earcut produces degenerate triangles on incorrectly-wound polygons
// at certain zoom levels — this manifests as a rogue triangle artifact on map.
function rewindFeature(f: unknown): unknown {
  const feat = f as any;
  if (!feat?.geometry) return f;
  const { type, coordinates } = feat.geometry;
  if (type === 'Polygon') {
    return {
      ...feat,
      geometry: {
        type,
        coordinates: (coordinates as number[][][]).map((ring, i) =>
          enforceWinding(ring, i === 0)
        ),
      },
    };
  }
  if (type === 'MultiPolygon') {
    return {
      ...feat,
      geometry: {
        type,
        coordinates: (coordinates as number[][][][]).map(polygon =>
          polygon.map((ring, i) => enforceWinding(ring, i === 0))
        ),
      },
    };
  }
  return f;
}

export function extractFeatures(d: GeoJSONFeatureCollection | undefined): unknown[] {
  const raw: unknown[] = Array.isArray(d?.map?.features)
    ? (d.map.features as unknown[])
    : Array.isArray(d?.features)
    ? d.features
    : [];
  return raw.map(rewindFeature);
}

export async function fetchDeepState(): Promise<GeoJSONFeatureCollection> {
  const res = await stealthFetch('https://deepstatemap.live/api/history/last', {
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error(`DeepState returned ${res.status}`);
  return res.json();
}
