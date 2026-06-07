
import { NextResponse } from 'next/server';
import { fetchDeepState, extractFeatures, type GeoJSONFeatureCollection } from '@/lib/deepstate';

export const dynamic = 'force-dynamic';

/**
 * OSIRIS — Ukraine Frontline API
 * Fetches live warfront GeoJSON from DeepState Map and Militaryland.net in parallel,
 * merging features from both sources into a single FeatureCollection.
 * Gracefully degrades to DeepState only if Militaryland is unavailable.
 */

// Militaryland (militaryland.net/ua/front-line/geojson) returns 404 — endpoint is dead.
// Removed to eliminate the 10s timeout on every frontline poll.

export async function GET() {
  let deepStateData: GeoJSONFeatureCollection;
  try {
    deepStateData = await fetchDeepState();
  } catch (reason) {
    console.error('Frontlines fetch error (DeepState):', reason);
    return NextResponse.json(
      { frontlines: null, error: 'DeepState unavailable' },
      { status: 502 }
    );
  }

  const sources: string[] = ['DeepState'];
  const mergedFeatures: unknown[] = extractFeatures(deepStateData);

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

