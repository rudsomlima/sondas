# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install
npm run dev      # local dev server, http://localhost:3000
npm run build    # production build (Next.js)
npm run start    # serve production build
npm run lint     # next lint
```

There is no test suite configured. No env vars are required for local dev (R2 persistence degrades to no-op without credentials — see below).

## Architecture

Next.js 15 (App Router) + TypeScript app that monitors radiosonde (weather balloon) launches across South American weather stations, defaulting to Natal/INMET 82599. It scrapes the University of Wyoming sounding archive for launch times and cross-references them against radiosondy.info to plot recovery positions on a map.

### Multi-station support

- **`app/lib/stations.ts`** — static list of ~40 South American stations (`SOUTH_AMERICA_STATIONS`), each with `{ id (STNM), name, lat, lon, radiosondyStartplace? }`. `radiosondyStartplace` links a Wyoming station to its corresponding radiosondy.info launch-site name when known — the two systems use *different, unrelated names* for the same physical site (e.g. Wyoming's "Natal Aeroporto" ↔ radiosondy.info's "Barreira do Inferno Launch Center (BR)"). These pairs were derived by matching geographic proximity (lat/lon), not name similarity — about half the stations have no known radiosondy.info counterpart and are left unmapped (`getRadiosondyStartplace()` returns `null`).
- **Wyoming API migrou em 2026** do endpoint legado `https://weather.uwyo.edu/cgi-bin/sounding` (404) para `https://weather.uwyo.edu/wsgi/sounding`. A nova API usa dois steps: (1) inventário anual `?datetime=YYYY-MM-DD 12:00:00&id=STNM&type=INVENTORY&src=FM35` → lista de datetimes disponíveis; (2) sondagem individual `?datetime=YYYY-MM-DD HH:MM:SS&id=STNM&src=FM35&type=TEXT:LIST`. Novo formato de header: `Observations for Station XXXXX at HH UTC DD Mon YYYY`. Parâmetro `src=FM35` (antigo `region=samer`).
- The selected station is persisted to `localStorage` (`sondas_station`) via `getSelectedStation()`/`setSelectedStation()`, shared between `app/configuracoes` (search-and-select UI, only applied on "Salvar") and `app/historico` (plain `<select>`, applied immediately on change — also resets the open map/match state since changing station changes what's displayed live).
- Every Wyoming-facing API call takes `station` as an explicit param/query string — there is no hardcoded default station at the API layer (the *UI* defaults to `DEFAULT_STATION` = 82599 if nothing is persisted yet).

### Data flow (Wyoming launch history)

1. **`app/api/sounding/route.ts`** — the only real backend logic for launch times. `GET` supports three `action` query params, all taking a `station` param (defaults to 82599):
   - `action=today` — fetches/parses the current month from Wyoming, returns whether a launch happened today for that station.
   - `action=month` — syncs one month incrementally into that station's year Blob store.
   - `action=year` — syncs all months up to the current month.

   Internally it scrapes `https://weather.uwyo.edu/cgi-bin/sounding?region=samer&TYPE=TEXT:LIST...&STNM={station}` HTML and regex-parses `Observations at HHZ DD Mon YYYY` lines into `Launch` records (date/time converted to GMT-3). Wyoming responses are flaky (intermittent 400/403/500 unrelated to the request), so fetches retry up to 3x with backoff and a 15s timeout.

2. **`app/lib/blobStore.ts`** — persists one JSON file per station+year to Cloudflare R2 (S3-compatible API via `@aws-sdk/client-s3`). The default station (82599) keeps the legacy path `sondas/history-{year}.json`; every other station gets `sondas/history-{station}-{year}.json`. No-ops entirely if `R2_ACCOUNT_ID`/`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY` are not set (e.g. local dev without `.env.local`), so the API still works locally, just without cross-request persistence. Requires `R2_BUCKET_NAME` (defaults to `"sondas"`).

3. **In-memory cache** inside `route.ts` (`memoryCache` Map, per server instance, keyed by station+year+month): current month cached 1 hour, past months cached permanently for the life of the instance. Sits in front of the Blob store and Wyoming fetch.

4. **`app/lib/cache.ts`** — client-side cache, fully separate from the server cache. Persists the annual history to `localStorage` (`sondas_cache_v1`), keyed by year+month+station (`station` is optional on `CacheEntry` for backward compat — absent means the default station), versioned, with export/import as JSON and per-month/per-year deletion.

5. **Sync model**: `syncMonth()` in `route.ts` only fetches days after the last day already stored for that month (`FROM=` param), merging into existing data rather than re-fetching whole months. A month is marked `monthsComplete` once finalized; the current month is never marked complete since it can still gain launches. `sanitizeStore()` defends against bad data from older code versions (launches misfiled into the wrong year, or months beyond "today" due to a past timezone bug).

6. **Timezone handling**: all "now" calculations go through `nowGMT3()` (`Date.now() + GMT3` offset), deliberately avoiding `Date.getTimezoneOffset()` so behavior is identical regardless of the host machine/server's local timezone. Launch timestamps from Wyoming are UTC; converting to GMT-3 local can shift a launch across a month/day boundary, which `parseLaunches()` explicitly guards against (falls back to UTC date when the -3h adjustment crosses a month boundary).

### radiosondy.info integration (`app/lib/radiosondy.ts`)

Plain module (no `'use client'`), so it's importable from both client components and server API routes/cron jobs. Two distinct data sources, both with open CORS:

- **Historical recovery search** — `fetchRadiosondyFeatures(year, month, startplace)` hits `export_search.php` to find where a *given past launch's* sonde was recovered. `findRecoveredMatch(features, launchInstant)` picks the GeoJSON point whose timestamp is closest *after* the launch instant, falling back to the closest point *before* it — but **both directions are bounded by `MAX_MATCH_WINDOW_MS` (3h)**. This window was deliberately tightened from an earlier 18h: a wider window let the fallback "steal" the *next* launch's already-correct recovery (two launches 12h apart, e.g. 00Z/12Z, can have their closest-published recovery only ~10h apart when the second flight hasn't landed yet) — confirmed against live radiosondy.info data during development. Real flight duration (ascent+descent to landing) is ~2-2.5h, so 3h is the tightest window that doesn't risk false negatives.
- **Live flight tracking** — `fetchLiveFlights()` hits `export_map.php?live_map=1`, the same global (~1MB) feed that powers radiosondy.info's own "Now Flying!" home section. A sonde appears here only while still airborne. `fetchTodayFlights(todayStr, startplace)` unions today's live sondes with today's already-landed ones (derived from `fetchRadiosondyFeatures` on the current month, parsing `Altitude:`/`Climbing:` out of `popupContent` since the recovery feed doesn't expose them as structured fields), keyed by sonde number, each tagged `isLive: true/false`. This exists because Wyoming (the official launch-time source) lags well behind real-time — `fetchTodayFlights` is often the only way to know "did a balloon go up today" before Wyoming publishes it.
- `matchesStartplace()` matches a live-feed entry to a startplace, with a lat/lon bounding-box fallback *only* for Natal's startplace (covers flights that drift over Rio Grande do Norte but report a slightly different startplace string).
- `sondeHubUrl(sondeNumber, lat, lon)` builds an external sondehub.org link centered on the sonde's actual last known position — must always be passed real coordinates, never a fixed/guessed center (a previous bug centered every link on Natal regardless of which station's sonde was being viewed).
- `findRecoveredMatch` is intentionally synchronous/network-free (operates on already-fetched `features`) so callers can avoid the heavy live-feed fetch unless truly needed — `LaunchMap.tsx` only calls `fetchRadiosondyFeatures` per (startplace, month), never per click within an already-cached month, and never touches `fetchLiveFlights` at all (that fallback path was deliberately removed from the interactive map — see git history if "still in flight" matching needs to come back).
- Builds custom Leaflet divIcons (`buildBalloonIcon`/`buildHighlightBalloonIcon`) color-coded by recovery status, each with a day-of-month + day/night (sun/moon) label baked into the icon HTML via `gmt3IconLabel()`/`IconLabel`.

### Background radiosondy-match sync (`app/api/radiosondy-sync/route.ts`)

A Vercel Cron job (see `vercel.json`, currently `0 6 * * *`, no auth) that pre-computes, per launch, whether a radiosondy.info correspondence exists — written back into each `Launch.radiosondyMatch` (`'yes' | 'no' | undefined`) in the Blob-persisted year store. Goals: avoid the client doing this reactively on every click (which used to mean a multi-second fetch before the map could render), and let the calendar grid show "no correspondence" badges before the user ever opens the map.

- Only processes stations with a known `radiosondyStartplace` and the current year.
- Never rechecks a launch that already has `radiosondyMatch` set (idempotent/resumable across cron runs if one times out — `maxDuration = 60`).
- Fetches `fetchRadiosondyFeatures` once per (station, month) with pending launches, not once per launch.
- Fetches the live feed (~1MB) at most once per *entire run* (lazy, only if some pending launch is still within the match window), shared across all stations/months in that run.
- Launches still inside the match window with no result yet are left unset (re-checked next run) rather than marked `'no'`, since they may simply not be processed yet.
- `LaunchMap.tsx` reads `launch.radiosondyMatch === 'no'` to skip the radiosondy.info fetch entirely and jump straight to showing a fallback link to the Wyoming sounding page for that exact day/hour (`region=samer&TYPE=TEXT:LIST&FROM={DD}{HH}&TO={DD}{HH}&STNM={station}`) — proof that a launch happened even without a tracked position.

### Pages

- `app/page.tsx` — redirects to `/historico`.
- `app/historico/page.tsx` — main historical view, and also the home for live status:
  - "Ao vivo" card renders unconditionally as the first thing on the page (not gated on year data having loaded), polling `fetchTodayFlights()` every 20s — but only for the currently selected station, and only if it has a known `radiosondyStartplace` (`hasRadiosondyCoverage`). Shows per-sonde status (red = `isLive` i.e. still in flight, green = landed), altitude, sonde number, and last-report time converted to GMT-3 24h (`formatGmt3`), plus a "last checked" timestamp.
  - Below that: yearly bar chart (Recharts) of launches per month, backed by both server (`/api/sounding?action=year&station=...`) and client cache (`app/lib/cache.ts`).
  - Clicking a launch time in the month-by-day grid selects it (`selectedLaunch`) and opens `LaunchMap`; times already known to have no radiosondy.info correspondence (`radiosondyMatch === 'no'` or previously discovered via `LaunchMap`'s `onResult` callback into `noMatchLaunches`) render muted instead of amber/indigo, with an explanatory `title`.
- `app/historico/LaunchMap.tsx` — Leaflet map rendering radiosondy.info recovery positions for a past launch; takes the current `station` as a prop to resolve its `radiosondyStartplace`.
- `app/configuracoes/page.tsx` — station search/select (diacritic-insensitive, via `searchStations`) and display settings (auto-refresh interval). No longer has a partial extraction-period setting — extraction always covers the full day.
- `app/api/cache/route.ts` — thin status/info endpoint; actual cache mutation happens client-side via `localStorage` (this route just confirms intent for UI flows).

### Key invariants to preserve when touching this code

- Region is always `region=samer` for every South American station (confirmed empirically, both legacy/`FM35` and `BUFR` source stations) — don't reintroduce a per-station region setting.
- Wyoming's `TO=` day param must be a real day-of-month (e.g. never `31` for a 30-day month) or it 400s — see `lastDay` computation in `fetchSounding`. Wyoming is also flaky in a second way: the *same* request can non-deterministically omit the most recent observation near a month boundary (observed directly: identical `TO=3023` requests returned 8 vs 9 entries across repeated calls) — this is server-side flakiness, not a bug in our parsing, and self-heals in production because `syncMonth`'s merge is additive and Blob-persisted (never overwrites with less data); it does *not* self-heal locally without Blob credentials, since each request restarts from an empty store.
- Don't fetch whole months on every request — always go through `syncMonth`'s incremental "fetch from last stored day" pattern.
- Server memory cache, client localStorage cache, and the Blob store are three independent layers; a fix in one does not propagate to the others.
- radiosondy.info's live feed (`export_map.php?live_map=1`) returns `report` timestamps with a lowercase trailing `z` (e.g. `"2026-06-23 12:57:32z"`) — appending another `Z` for `Date` parsing produces an invalid date silently. Always strip the existing `z`/`Z` before re-appending one (see `gmt3DateStr`/`formatGmt3` for the correct pattern).
- `Launch` is duplicated as an identical interface across four files (`app/api/sounding/route.ts`, `app/lib/blobStore.ts`, `app/historico/page.tsx`, `app/historico/LaunchMap.tsx`) — there's no shared import; when adding a field (like `radiosondyMatch`), add it to all four.
- Don't widen `MAX_MATCH_WINDOW_MS` (`app/lib/radiosondy.ts`) without re-verifying against real radiosondy.info data — it was deliberately narrowed from 18h to 3h to fix exactly this kind of cross-launch contamination; a too-wide window silently produces *wrong but plausible-looking* matches rather than an honest "no match".
