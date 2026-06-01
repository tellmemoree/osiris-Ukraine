import { stealthFetch } from '@/lib/stealthFetch';

/**
 * OSIRIS — Shadow Fleet Watchlist (dynamic)
 *
 * Maintains live sets of sanctioned / dark-fleet vessel identifiers — both IMO
 * numbers and MMSIs — refreshed from a public sanctions source on a TTL and
 * cached in-memory. Designed to fail safe: if the network source is unreachable
 * or returns nothing parseable, the curated SEED list is kept so the maritime
 * layer never goes blind.
 *
 * Why both IMO and MMSI: AIS broadcasts the IMO only in the infrequent
 * ShipStaticData (type-5) message, but the MMSI rides on every position report
 * (type 1/2/3). Matching on MMSI therefore flags a sanctioned vessel immediately
 * from its position stream, instead of waiting for (and depending on) a static
 * message that many dark-fleet tankers never send. IMO matching is kept as the
 * complementary path for vessels whose MMSI is absent from the source.
 *
 * Default source: OFAC SDN list (keyless, ~5.5 MB CSV). Vessel entries embed
 * `IMO 1234567` and often `MMSI 123456789` in the remarks column, extracted by
 * regex. Override with SHADOW_FLEET_SOURCE_URL to point at any endpoint that
 * returns IMOs as JSON (array of numbers, `{ imos: [...] }`, or objects with an
 * `imo`/`imoNumber` field) or as free text containing `IMO <7 digits>` /
 * `MMSI <9 digits>`.
 */

// Curated fallback (KSE Institute / CREA public shadow-fleet lists, snapshot 2026-05).
// Always merged into the live set so hand-vetted vessels survive a source outage.
const SEED_IMOS: number[] = [
  9246234, 9274848, 9167667, 9251899, 9389650, 9374910, 9256887, 9246258,
  9178523, 9210220, 9381867, 9193215, 9230670, 9285449, 9285451, 9302872,
  9344720, 9368292, 9400801, 9412205, 9436222, 9469688, 9502518, 9543009,
  9596068, 9629948, 9648701, 9668519, 9699030, 9704043, 9727785, 9747416,
];

const SOURCE_URL =
  process.env.SHADOW_FLEET_SOURCE_URL ?? 'https://www.treasury.gov/ofac/downloads/sdn.csv';

const TTL_MS = 12 * 60 * 60 * 1000; // refresh at most every 12h
const ERROR_BACKOFF_MS = 5 * 60 * 1000; // after a failure, retry in 5 min (not on every call)

let imos = new Set<number>(SEED_IMOS);
let mmsis = new Set<number>();
let lastRefresh = 0;
let refreshing: Promise<void> | null = null;

// IMO numbers are exactly 7 digits.
function isValidImo(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 1_000_000 && n <= 9_999_999;
}

// MMSI is exactly 9 digits; real ship station IDs use MID prefixes 2–7.
function isValidMmsi(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 200_000_000 && n <= 799_999_999;
}

/** Parse IMO numbers out of a source payload (JSON in several shapes, or CSV/text). */
export function parseImos(body: string): number[] {
  const trimmed = body.trimStart();

  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const json: unknown = JSON.parse(body);
      const arr: unknown[] = Array.isArray(json)
        ? json
        : Array.isArray((json as { imos?: unknown[] })?.imos)
          ? (json as { imos: unknown[] }).imos
          : [];
      const out = arr
        .map((item) => {
          if (typeof item === 'number') return item;
          if (typeof item === 'string') return Number(item);
          const obj = item as { imo?: unknown; imoNumber?: unknown };
          return Number(obj?.imo ?? obj?.imoNumber);
        })
        .filter(isValidImo);
      if (out.length > 0) return out;
      // Fall through to regex if JSON had no usable IMOs.
    } catch {
      // Not JSON after all — fall through to the text scanner.
    }
  }

  // Free-text / CSV: match "IMO 1234567" (optional colon/whitespace).
  const out: number[] = [];
  const re = /IMO[:\s]*?(\d{7})\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const n = Number(m[1]);
    if (isValidImo(n)) out.push(n);
  }
  return out;
}

/** Parse MMSIs out of a free-text / CSV source payload ("MMSI 123456789"). */
export function parseMmsis(body: string): number[] {
  const out: number[] = [];
  const re = /MMSI[:\s]*?(\d{9})\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const n = Number(m[1]);
    if (isValidMmsi(n)) out.push(n);
  }
  return out;
}

async function refresh(): Promise<void> {
  try {
    const res = await stealthFetch(SOURCE_URL, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`watchlist source returned ${res.status}`);

    const body = await res.text();
    const parsedImos = parseImos(body);
    const parsedMmsis = parseMmsis(body);
    if (parsedImos.length === 0 && parsedMmsis.length === 0) {
      console.warn('[OSIRIS] shadow-fleet source yielded 0 identifiers; keeping current set');
      lastRefresh = Date.now() - TTL_MS + ERROR_BACKOFF_MS;
      return;
    }

    // Merge IMOs with the seed so curated entries are never lost. MMSIs have no
    // seed, and the OFAC source embeds the `MMSI` token far more rarely than
    // `IMO` — so only replace the MMSI set when this refresh actually parsed
    // some, otherwise keep the previously-populated set instead of going blind.
    imos = new Set<number>([...SEED_IMOS, ...parsedImos]);
    if (parsedMmsis.length > 0) {
      mmsis = new Set<number>(parsedMmsis);
    }
    lastRefresh = Date.now();
    console.log(
      `[OSIRIS] shadow-fleet watchlist refreshed: ${imos.size} IMOs, ${mmsis.size} MMSIs (${parsedImos.length}/${parsedMmsis.length} from source)`
    );
  } catch (err) {
    console.warn(
      '[OSIRIS] shadow-fleet refresh failed; using cached/seed set:',
      err instanceof Error ? err.message : err
    );
    lastRefresh = Date.now() - TTL_MS + ERROR_BACKOFF_MS;
  } finally {
    refreshing = null;
  }
}

// Kicks off a background refresh when the set is stale, so callers (including the
// hot AIS message handler) never block. The first call returns the SEED set
// immediately while the first fetch runs.
function maybeRefresh(): void {
  if (!refreshing && Date.now() - lastRefresh > TTL_MS) {
    refreshing = refresh();
  }
}

/** Current sanctioned-IMO watchlist (synchronous; refreshes in the background). */
export function getShadowFleetImos(): Set<number> {
  maybeRefresh();
  return imos;
}

/** Current sanctioned-MMSI watchlist (synchronous; refreshes in the background). */
export function getShadowFleetMmsis(): Set<number> {
  maybeRefresh();
  return mmsis;
}
