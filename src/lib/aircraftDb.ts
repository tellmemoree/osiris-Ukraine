// Maps ICAO24 hex codes to ICAO type designators (e.g. "B738", "G550", "C172").
// Data comes from hexdb.io, persisted to ~/.osiris-data/aircraft-types.json so
// lookups survive container restarts. Non-airline aircraft are prefetched in the
// background after each OpenSky refresh; airlines are already correctly classified
// by callsign so their type codes are lower priority.

const HEXDB_BASE = 'https://hexdb.io/api/v1/aircraft/';
const CACHE_PATH = '/home/nextjs/.osiris-data/aircraft-types.json';
const BATCH_SIZE = 20;
const SAVE_DELAY_MS = 15_000;

// hex → ICAO type code. '' = confirmed unknown in DB; undefined = not yet fetched.
const typeCache = new Map<string, string>();
const pending = new Set<string>();

let dbReady: Promise<void> | null = null;
let draining = false;
let dirty = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

export function loadDb(): Promise<void> {
  if (dbReady) return dbReady;
  dbReady = (async () => {
    try {
      const { readFile } = await import('fs/promises');
      const raw = await readFile(CACHE_PATH, 'utf-8');
      const data = JSON.parse(raw) as Record<string, string>;
      for (const [k, v] of Object.entries(data)) typeCache.set(k, v);
      console.log(`[aircraftDb] loaded ${typeCache.size} cached type entries`);
    } catch {
      // No file yet — fresh start
    }
  })();
  return dbReady;
}

function scheduleSave(): void {
  if (saveTimer || !dirty) return;
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    try {
      const { writeFile } = await import('fs/promises');
      const obj: Record<string, string> = {};
      typeCache.forEach((v, k) => { obj[k] = v; });
      await writeFile(CACHE_PATH, JSON.stringify(obj));
      dirty = false;
    } catch (e) {
      console.warn('[aircraftDb] save failed:', e);
    }
  }, SAVE_DELAY_MS);
}

async function drainQueue(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    while (pending.size > 0) {
      const batch = [...pending].slice(0, BATCH_SIZE);
      batch.forEach(h => pending.delete(h));

      let rateLimited = false;
      await Promise.allSettled(batch.map(async hex => {
        try {
          const res = await fetch(`${HEXDB_BASE}${hex}`, {
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(5000),
          });
          if (res.status === 429) {
            rateLimited = true;
            pending.add(hex); // return to queue for next cycle
            return;
          }
          const type = res.ok
            ? ((await res.json() as { ICAOTypeCode?: string }).ICAOTypeCode ?? '')
            : '';
          typeCache.set(hex, type);
          dirty = true;
        } catch {
          // Transient error — don't cache, will retry next prefetch cycle
        }
      }));

      scheduleSave();
      if (rateLimited) break;
    }
  } finally {
    draining = false;
  }
}

/** Synchronous lookup. Returns '' for unknowns or not-yet-fetched hex codes. */
export function lookupType(hex: string): string {
  return typeCache.get(hex) ?? '';
}

/**
 * Schedule background hexdb.io lookups for hex codes not yet in cache.
 * Non-blocking — results appear in subsequent lookupType() calls.
 */
export function prefetchTypes(hexes: string[]): void {
  let queued = 0;
  for (const hex of hexes) {
    if (hex && !typeCache.has(hex)) {
      pending.add(hex);
      queued++;
    }
  }
  if (queued > 0) {
    drainQueue().catch(() => {});
  }
}
