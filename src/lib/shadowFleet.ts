import { stealthFetch } from '@/lib/stealthFetch';

/**
 * OSIRIS — Shadow Fleet IMO Watchlist (dynamic)
 *
 * Maintains a live set of sanctioned / dark-fleet vessel IMO numbers, refreshed
 * from a public sanctions source on a TTL and cached in-memory. Designed to fail
 * safe: if the network source is unreachable or returns nothing parseable, the
 * curated SEED list is kept so the maritime layer never goes blind.
 *
 * Default source: OFAC SDN list (keyless, ~5.5 MB CSV). Vessel entries embed
 * their IMO as `IMO 1234567` in the remarks column, which we extract by regex.
 * Override with the SHADOW_FLEET_SOURCE_URL env var to point at any endpoint
 * that returns IMOs as JSON (array of numbers, `{ imos: [...] }`, or objects
 * with an `imo`/`imoNumber` field) or as free text containing `IMO <7 digits>`.
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
let lastRefresh = 0;
let refreshing: Promise<void> | null = null;

// IMO numbers are exactly 7 digits.
function isValidImo(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 1_000_000 && n <= 9_999_999;
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

async function refresh(): Promise<void> {
  try {
    const res = await stealthFetch(SOURCE_URL, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`watchlist source returned ${res.status}`);

    const parsed = parseImos(await res.text());
    if (parsed.length === 0) {
      console.warn('[OSIRIS] shadow-fleet source yielded 0 IMOs; keeping current set');
      lastRefresh = Date.now() - TTL_MS + ERROR_BACKOFF_MS;
      return;
    }

    // Merge with the seed so curated entries are never lost.
    imos = new Set<number>([...SEED_IMOS, ...parsed]);
    lastRefresh = Date.now();
    console.log(`[OSIRIS] shadow-fleet watchlist refreshed: ${imos.size} IMOs (${parsed.length} from source)`);
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

/**
 * Returns the current watchlist synchronously. Kicks off a background refresh when
 * the set is stale, so callers (including the hot AIS message handler) never block.
 * The first call returns the SEED set immediately while the first fetch runs.
 */
export function getShadowFleetImos(): Set<number> {
  if (!refreshing && Date.now() - lastRefresh > TTL_MS) {
    refreshing = refresh();
  }
  return imos;
}
