
import { NextResponse } from 'next/server';
import { fetchDeepState, extractFeatures, type GeoJSONFeatureCollection } from '@/lib/deepstate';

export const dynamic = 'force-dynamic';

// Militaryland (militaryland.net/ua/front-line/geojson) returns 404 — endpoint is dead.

function parseStatus(name: string): { statusKey: string; statusLabel: string } {
  if (name.includes('geoJSON.status.dismissed_at')) return { statusKey: 'dismissed_at', statusLabel: 'Liberated' };
  if (name.includes('geoJSON.status.dismissed'))    return { statusKey: 'dismissed',    statusLabel: 'Liberated' };
  if (name.includes('geoJSON.status.occupied'))     return { statusKey: 'occupied',     statusLabel: 'Occupied' };
  if (name.includes('geoJSON.status.unknown'))      return { statusKey: 'unknown',      statusLabel: 'Unknown Status' };
  if (name.includes('geoJSON.status.attack_direction')) return { statusKey: 'attack_direction', statusLabel: 'Attack Direction' };
  return { statusKey: 'other', statusLabel: '' };
}

function extractEnglish(text: string): string {
  const parts = text.split('///');
  const en = parts.find(p => /[a-zA-Z]{3}/.test(p) && !p.trim().startsWith('geoJSON'));
  return en ? en.trim() : '';
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

// Parse liberation date from name like "{{at:25.03}}" — all are 2022 (Kyiv/Kharkiv pullback)
function parseDismissedDate(name: string): string | null {
  const m = name.match(/\{\{at:([^}]+)\}\}/);
  if (!m) return null;
  const first = m[1].trim().split(/[\s–\-]+/)[0].trim();
  const parts = first.split('.');
  if (parts.length < 2) return null;
  const [day, month] = parts;
  return `2022-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

function enrichFeatures(features: unknown[]): unknown[] {
  return features.map((f: any) => {
    const props = f?.properties || {};
    const name: string = props.name || '';
    const desc: string = props.description || '';
    const { statusKey, statusLabel } = parseStatus(name);
    const descriptionEn = extractEnglish(stripHtml(desc));
    const eventDate = statusKey === 'dismissed_at' ? parseDismissedDate(name) : null;

    return {
      ...f,
      properties: {
        ...props,
        statusKey,
        statusLabel,
        descriptionEn,
        ...(eventDate ? { eventDate } : {}),
      },
    };
  });
}

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

  const raw = extractFeatures(deepStateData);
  const enriched = enrichFeatures(raw);

  // Drop territories liberated before 2026 — all dismissed/dismissed_at entries are
  // 2022 pullback areas (Kyiv, Bucha, Irpin, Kharkiv oblast, etc.).
  const filtered = enriched.filter((f: any) => {
    const sk = f?.properties?.statusKey;
    return sk !== 'dismissed' && sk !== 'dismissed_at';
  });

  const frontlines: GeoJSONFeatureCollection = {
    type: 'FeatureCollection',
    features: filtered,
  };

  return NextResponse.json(
    {
      frontlines,
      sources: ['DeepState'],
      timestamp: new Date().toISOString(),
    },
    {
      headers: {
        'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=3600',
      },
    }
  );
}
