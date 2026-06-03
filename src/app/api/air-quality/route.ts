import { NextResponse } from 'next/server';

/**
 * OSIRIS — Air Quality Monitoring API
 * Source: Open-Meteo Air Quality API — FREE, no API key, ~10k calls/day.
 *   https://air-quality-api.open-meteo.com/v1/air-quality
 *
 * Open-Meteo is point-based (not a global "stations" feed), so we batch a curated
 * list of major world cities (with Ukraine/Russia emphasis) into a single
 * multi-coordinate request and map the per-point `current` readings to station
 * markers. (Replaces the dead OpenAQ v2 endpoint, which now returns HTTP 410.)
 */

interface City { name: string; country: string; lat: number; lng: number; }

// Curated coverage: global majors + conflict-region cities for relevance.
const CITIES: City[] = [
  // Ukraine
  { name: 'Kyiv', country: 'Ukraine', lat: 50.4501, lng: 30.5234 },
  { name: 'Lviv', country: 'Ukraine', lat: 49.8397, lng: 24.0297 },
  { name: 'Kharkiv', country: 'Ukraine', lat: 49.9935, lng: 36.2304 },
  { name: 'Odesa', country: 'Ukraine', lat: 46.4825, lng: 30.7233 },
  { name: 'Dnipro', country: 'Ukraine', lat: 48.4647, lng: 35.0462 },
  // Russia
  { name: 'Moscow', country: 'Russia', lat: 55.7558, lng: 37.6173 },
  { name: 'St. Petersburg', country: 'Russia', lat: 59.9311, lng: 30.3609 },
  { name: 'Rostov-on-Don', country: 'Russia', lat: 47.2357, lng: 39.7015 },
  { name: 'Yekaterinburg', country: 'Russia', lat: 56.8389, lng: 60.6057 },
  // Europe
  { name: 'London', country: 'UK', lat: 51.5074, lng: -0.1278 },
  { name: 'Paris', country: 'France', lat: 48.8566, lng: 2.3522 },
  { name: 'Berlin', country: 'Germany', lat: 52.5200, lng: 13.4050 },
  { name: 'Madrid', country: 'Spain', lat: 40.4168, lng: -3.7038 },
  { name: 'Rome', country: 'Italy', lat: 41.9028, lng: 12.4964 },
  { name: 'Warsaw', country: 'Poland', lat: 52.2297, lng: 21.0122 },
  { name: 'Istanbul', country: 'Turkey', lat: 41.0082, lng: 28.9784 },
  // Middle East
  { name: 'Tel Aviv', country: 'Israel', lat: 32.0853, lng: 34.7818 },
  { name: 'Cairo', country: 'Egypt', lat: 30.0444, lng: 31.2357 },
  { name: 'Tehran', country: 'Iran', lat: 35.6892, lng: 51.3890 },
  { name: 'Riyadh', country: 'Saudi Arabia', lat: 24.7136, lng: 46.6753 },
  { name: 'Dubai', country: 'UAE', lat: 25.2048, lng: 55.2708 },
  // Asia
  { name: 'Delhi', country: 'India', lat: 28.6139, lng: 77.2090 },
  { name: 'Mumbai', country: 'India', lat: 19.0760, lng: 72.8777 },
  { name: 'Beijing', country: 'China', lat: 39.9042, lng: 116.4074 },
  { name: 'Shanghai', country: 'China', lat: 31.2304, lng: 121.4737 },
  { name: 'Tokyo', country: 'Japan', lat: 35.6762, lng: 139.6503 },
  { name: 'Seoul', country: 'South Korea', lat: 37.5665, lng: 126.9780 },
  { name: 'Jakarta', country: 'Indonesia', lat: -6.2088, lng: 106.8456 },
  { name: 'Bangkok', country: 'Thailand', lat: 13.7563, lng: 100.5018 },
  { name: 'Singapore', country: 'Singapore', lat: 1.3521, lng: 103.8198 },
  { name: 'Karachi', country: 'Pakistan', lat: 24.8607, lng: 67.0011 },
  // Americas
  { name: 'New York', country: 'US', lat: 40.7128, lng: -74.0060 },
  { name: 'Los Angeles', country: 'US', lat: 34.0522, lng: -118.2437 },
  { name: 'Chicago', country: 'US', lat: 41.8781, lng: -87.6298 },
  { name: 'Mexico City', country: 'Mexico', lat: 19.4326, lng: -99.1332 },
  { name: 'São Paulo', country: 'Brazil', lat: -23.5505, lng: -46.6333 },
  { name: 'Buenos Aires', country: 'Argentina', lat: -34.6037, lng: -58.3816 },
  { name: 'Toronto', country: 'Canada', lat: 43.6532, lng: -79.3832 },
  // Africa / Oceania
  { name: 'Lagos', country: 'Nigeria', lat: 6.5244, lng: 3.3792 },
  { name: 'Johannesburg', country: 'South Africa', lat: -26.2041, lng: 28.0473 },
  { name: 'Nairobi', country: 'Kenya', lat: -1.2921, lng: 36.8219 },
  { name: 'Sydney', country: 'Australia', lat: -33.8688, lng: 151.2093 },
];

// PM2.5 → level/color (WHO/EPA-ish bands), unchanged from the prior version.
function classify(pm25: number): { level: string; color: string } {
  if (pm25 > 150) return { level: 'Hazardous', color: '#8B0000' };
  if (pm25 > 100) return { level: 'Unhealthy', color: '#FF1744' };
  if (pm25 > 55) return { level: 'Unhealthy (Sensitive)', color: '#FF9500' };
  if (pm25 > 35) return { level: 'Moderate', color: '#FFD700' };
  return { level: 'Good', color: '#00E676' };
}

interface OpenMeteoPoint {
  current?: { us_aqi?: number; pm2_5?: number; pm10?: number };
}

export async function GET() {
  try {
    const lats = CITIES.map(c => c.lat).join(',');
    const lngs = CITIES.map(c => c.lng).join(',');
    const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lats}&longitude=${lngs}&current=us_aqi,pm2_5,pm10&timezone=UTC`;

    const res = await fetch(url, { signal: AbortSignal.timeout(12000), headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);

    // Multiple coordinates → array aligned to input order; a single coord → object.
    const body = await res.json();
    const points: OpenMeteoPoint[] = Array.isArray(body) ? body : [body];

    const stations = CITIES.map((c, i) => {
      const cur = points[i]?.current;
      if (!cur || typeof cur.pm2_5 !== 'number') return null;
      const pm25 = Math.round(cur.pm2_5 * 10) / 10;
      const { level, color } = classify(pm25);
      return {
        id: `aq-${c.name.toLowerCase().replace(/\s+/g, '-')}`,
        name: c.name,
        city: c.name,
        country: c.country,
        lat: c.lat,
        lng: c.lng,
        pm25,
        pm10: typeof cur.pm10 === 'number' ? Math.round(cur.pm10 * 10) / 10 : undefined,
        us_aqi: cur.us_aqi,
        unit: 'µg/m³',
        level,
        color,
      };
    }).filter((s): s is NonNullable<typeof s> => s !== null);

    return NextResponse.json(
      { stations, total: stations.length, timestamp: new Date().toISOString() },
      { headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200' } }
    );
  } catch (error) {
    console.error('Air Quality API error:', error);
    return NextResponse.json({ stations: [], error: 'Failed to fetch air quality data' }, { status: 500 });
  }
}
