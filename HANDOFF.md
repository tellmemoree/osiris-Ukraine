# HANDOFF — Review Archive

Resolved items from the osiris-Ukraine review pass. All items closed as of 2026-06.
Open items have been migrated to `docs/BACKLOG.md`.

---

## What was done

| # | Item | Commit |
|---|------|--------|
| — | Line endings normalized to LF; `.gitattributes` added | 70e2862 |
| — | `AdsbAircraft`, `Ship`, `ClassifiedFlight`, `FlightResponse` types added | 70e2862 |
| — | `bomb_risk` field removed from `flights/route.ts` (dead data, never consumed) | — |
| — | Ghost-ship injection (`fetchVesselApiFallback`) deleted | eda5ca8 |
| — | Shadow-fleet watchlist made dynamic (OFAC SDN + MMSI matching) | eda5ca8, 02f0e04 |
| — | KAB threat layer wired to Telegram OSINT (`/api/kab-threats`) | ac012f3 |
| — | React #418 hydration warning hardened; `suppressHydrationWarning` on `<body>` | eda5ca8 |
| — | CRLF renormalized (27 files); 6 RSS-parsing `any`s typed | b4eb139 |
| — | Ukraine oblast/district GeoJSON fixed (76 self-intersecting rings via `mapshaper -clean`) | — |
| — | RU Telegram milblog channels added; `side` tagging + RU tab in LiveAlerts | e431f67 |
| — | Repo-root cleanup: 18 one-off scripts/patches removed | — |
| — | RU camera expansion removed (MJPEG geoblocked at browser; proxy costs prohibitive) | — |

## Accepted debt

- **`no-explicit-any` lint debt** — ~304 ESLint errors, overwhelmingly in `OsirisMap.tsx` and master-origin files. Won't fix on this branch; ESLint is non-blocking in the build. New code stays lint-clean.

## Standing notes

- `/api/air-raids` uses `vadimklimenko.com/map/statuses.json` — binary on/off per region, no threat type. `alerts.in.ua` is token-gated and has no KAB category.
- `/api/kab-threats` knobs: `UA_THREAT_CHANNELS`, `KAB_PATTERNS`, `OBLAST_REFS`, `WINDOW_HOURS` (3), `CACHE_TTL_MS` (60s).
- Shadow-fleet source overridable via `SHADOW_FLEET_SOURCE_URL`.
- Camera expansion docs (Shodan host-search, go2rtc/MediaMTX relay pattern): `docs/CAMERA_SOURCES.md`.
