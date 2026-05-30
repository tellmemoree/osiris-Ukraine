
import { NextResponse } from 'next/server';
import { stealthFetch } from '@/lib/stealthFetch';

/**
 * OSIRIS — Ukrainian Air Raid Alerts API
 * Fetches active air raid and threat alerts from alerts.in.ua.
 * No API key required for the active alerts endpoint.
 */

const OBLAST_COORDS: Record<string, [number, number]> = {
  'Вінницька область': [28.468, 49.233],
  'Волинська область': [25.325, 50.747],
  'Дніпропетровська область': [35.046, 48.465],
  'Донецька область': [37.800, 48.000],
  'Житомирська область': [28.658, 50.255],
  'Закарпатська область': [23.297, 48.620],
  'Запорізька область': [35.139, 47.838],
  'Івано-Франківська область': [24.711, 48.922],
  'Київська область': [30.523, 50.450],
  'м. Київ': [30.523, 50.450],
  'Кіровоградська область': [32.262, 48.508],
  'Луганська область': [39.300, 48.566],
  'Львівська область': [24.029, 49.839],
  'Миколаївська область': [31.994, 46.975],
  'Одеська область': [30.723, 46.482],
  'Полтавська область': [34.551, 49.588],
  'Рівненська область': [26.251, 50.620],
  'Сумська область': [34.800, 50.910],
  'Тернопільська область': [25.594, 49.553],
  'Харківська область': [36.230, 49.990],
  'Херсонська область': [32.601, 46.635],
  'Хмельницька область': [26.987, 49.423],
  'Черкаська область': [32.060, 49.445],
  'Чернівецька область': [25.940, 48.292],
  'Чернігівська область': [31.285, 51.498],
  'Crimea': [34.102, 44.952],
};

type AlertType = 'AIR' | 'ARTILLERY' | 'URBAN_FIGHTS' | 'CHEMICAL' | 'NUCLEAR' | 'INFO';

type RawAlert = {
  regionId?: number;
  regionName?: string;
  regionType?: string;
  alertType?: AlertType;
  startedAt?: string;
  [key: string]: unknown;
};

type EnrichedAlert = {
  regionId: number | null;
  regionName: string;
  regionType: string;
  alertType: AlertType | string;
  startedAt: string;
  lat: number | null;
  lng: number | null;
};

export async function GET() {
  try {
    const res = await stealthFetch('https://api.alerts.in.ua/v1/alerts/active.json', {
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      console.error(`[OSIRIS] alerts.in.ua responded with ${res.status}`);
      return NextResponse.json({ alerts: [], total: 0, error: `alerts.in.ua returned ${res.status}` });
    }

    const raw: RawAlert[] = await res.json();
    const rawAlerts = Array.isArray(raw) ? raw : [];

    const alerts: EnrichedAlert[] = rawAlerts.map((alert) => {
      const regionName = alert.regionName ?? '';
      const coords = OBLAST_COORDS[regionName] ?? null;
      return {
        regionId: alert.regionId ?? null,
        regionName,
        regionType: alert.regionType ?? '',
        alertType: alert.alertType ?? '',
        startedAt: alert.startedAt ?? '',
        lat: coords ? coords[1] : null,
        lng: coords ? coords[0] : null,
      };
    });

    const activeRegions = new Set(alerts.map((a) => a.regionName)).size;

    return NextResponse.json(
      {
        alerts,
        total: alerts.length,
        active_regions: activeRegions,
        timestamp: new Date().toISOString(),
      },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
        },
      }
    );
  } catch (error) {
    console.error('[OSIRIS] Air raid fetch error:', error);
    return NextResponse.json({
      alerts: [],
      total: 0,
      error: error instanceof Error ? error.message : 'Failed to fetch air raid data',
    });
  }
}
