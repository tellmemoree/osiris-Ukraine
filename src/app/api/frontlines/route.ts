
import { NextResponse } from 'next/server';
import { stealthFetch } from '@/lib/stealthFetch';

/**
 * OSIRIS — Ukraine Frontline API
 * Fetches live warfront GeoJSON from DeepState Map and Militaryland.net in parallel,
 * merging features from both sources into a single FeatureCollection.
 * Gracefully degrades to DeepState only if Militaryland is unavailable.
 */

interface GeoJSONFeatureCollection {
  type: 'FeatureCollection';
  features: unknown[];
  [key: string]: unknown;
}

async function fetchDeepState(): Promise<GeoJSONFeatureCollection> {
  const res = await stealthFetch('https://deepstatemap.live/api/history/last', {
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`DeepState returned ${res.status}`);
  return res.json();
}

async function fetchMilitaryland(): Promise<GeoJSONFeatureCollection> {
  const res = await stealthFetch('https://militaryland.net/ua/front-line/geojson', {
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Militaryland returned ${res.status}`);
  return res.json();
}

export async function GET() {
  const [deepStateResult, militarylandResult] = await Promise.allSettled([
    fetchDeepState(),
    fetchMilitaryland(),
  ]);

  if (deepStateResult.status === 'rejected') {
    console.error('Frontlines fetch error (DeepState):', deepStateResult.reason);
    return NextResponse.json(
      { frontlines: null, error: 'DeepState unavailable' },
      { status: 502 }
    );
  }

  const deepStateData = deepStateResult.value;
  const sources: string[] = ['DeepState'];

  let mergedFeatures: unknown[] = Array.isArray(deepStateData?.features)
    ? deepStateData.features
    : [];

  if (militarylandResult.status === 'fulfilled') {
    const mlData = militarylandResult.value;
    if (Array.isArray(mlData?.features)) {
      mergedFeatures = [...mergedFeatures, ...mlData.features];
      sources.push('Militaryland');
    }
  } else {
    console.warn('Frontlines fetch warning (Militaryland):', militarylandResult.reason);
  }

  const frontlines: GeoJSONFeatureCollection = {
    ...deepStateData,
    type: 'FeatureCollection',
    features: mergedFeatures,
  };

  return NextResponse.json(
    {
      frontlines,
      sources,
      timestamp: new Date().toISOString(),
    },
    {
      headers: {
        'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=3600',
      },
    }
  );
}

