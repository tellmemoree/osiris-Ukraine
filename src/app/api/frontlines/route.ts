
import { NextResponse } from 'next/server';
import { stealthFetch } from '@/lib/stealthFetch';
import { fetchDeepState, extractFeatures, type GeoJSONFeatureCollection } from '@/lib/deepstate';

/**
 * OSIRIS — Ukraine Frontline API
 * Fetches live warfront GeoJSON from DeepState Map and Militaryland.net in parallel,
 * merging features from both sources into a single FeatureCollection.
 * Gracefully degrades to DeepState only if Militaryland is unavailable.
 */

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

  let mergedFeatures: unknown[] = extractFeatures(deepStateData);

  if (militarylandResult.status === 'fulfilled') {
    const mlFeatures = extractFeatures(militarylandResult.value);
    if (mlFeatures.length) {
      mergedFeatures = [...mergedFeatures, ...mlFeatures];
      sources.push('Militaryland');
    }
  } else {
    console.warn('Frontlines fetch warning (Militaryland):', militarylandResult.reason);
  }

  // Build a clean FeatureCollection — don't spread deepStateData, which would
  // re-embed the entire nested `map` object and double the payload.
  const frontlines: GeoJSONFeatureCollection = {
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

