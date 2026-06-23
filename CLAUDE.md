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

There is no test suite configured. No env vars are required for local dev (Blob persistence degrades to no-op without credentials — see below).

## Architecture

Next.js 15 (App Router) + TypeScript app that monitors radiosonde (weather balloon) launches from the Natal/INMET 82599 weather station. It scrapes the University of Wyoming sounding archive and cross-references launch times against radiosondy.info to plot recovery positions on a map.

### Data flow

1. **`app/api/sounding/route.ts`** — the only real backend logic. `GET` supports three `action` query params:
   - `action=today` — fetches/parses the current month from Wyoming, returns whether a launch happened today.
   - `action=month` — syncs one month incrementally into the year's Blob store.
   - `action=year` — syncs all months up to the current month for a year.

   Internally it scrapes `https://weather.uwyo.edu/cgi-bin/sounding?...TYPE=TEXT:LIST...` HTML and regex-parses `Observations at HHZ DD Mon YYYY` lines into `Launch` records (date/time converted to GMT-3). Wyoming responses are flaky (intermittent 400/403/500 unrelated to the request), so fetches retry up to 3x with backoff and a 15s timeout.

2. **`app/lib/blobStore.ts`** — persists one JSON file per year (`sondas/history-{year}.json`) to Vercel Blob. No-ops entirely if neither `BLOB_READ_WRITE_TOKEN` nor `BLOB_STORE_ID` is set (e.g. local dev without `vercel env pull`), so the API still works locally, just without cross-request persistence.

3. **In-memory cache** inside `route.ts` (`memoryCache` Map, per server instance): current month cached 1 hour, past months cached permanently for the life of the instance. This sits in front of the Blob store and Wyoming fetch.

4. **`app/lib/cache.ts`** — client-side cache, fully separate from the server cache. Persists the full annual history to `localStorage` (`sondas_cache_v1`), versioned, with export/import as JSON and per-month/per-year deletion.

5. **Sync model**: `syncMonth()` in `route.ts` only fetches days after the last day already stored for that month (`FROM=` param), merging into existing data rather than re-fetching whole months. A month is marked `monthsComplete` once finalized; the current month is never marked complete since it can still gain launches. `sanitizeStore()` defends against bad data from older code versions (launches misfiled into the wrong year, or months beyond "today" due to a past timezone bug).

6. **Timezone handling**: all "now" calculations go through `nowGMT3()` (`Date.now() + GMT3` offset), deliberately avoiding `Date.getTimezoneOffset()` so behavior is identical regardless of the host machine/server's local timezone. Launch timestamps from Wyoming are UTC; converting to GMT-3 local can shift a launch across a month/day boundary, which `parseLaunches()` explicitly guards against (falls back to UTC date when the -3h adjustment crosses a month boundary).

7. **`app/lib/radiosondy.ts`** — separate, client-side-only integration with radiosondy.info, entirely independent of the Wyoming/Blob pipeline above (no server proxy needed; radiosondy.info's endpoints have open CORS). Two distinct data sources within the same file:
   - **Historical recovery search** — `fetchRadiosondyFeatures(year, month)` hits `export_search.php` (filtered to `startplace=Barreira do Inferno Launch Center (BR)`) to find where a *given past launch's* sonde was recovered. `findClosestAfter()` picks the GeoJSON point whose timestamp is closest *after* the launch instant (falls back to closest overall if nothing comes after).
   - **Live flight tracking** — `fetchLiveFlights()` hits `export_map.php?live_map=1`, the same global feed that powers radiosondy.info's own "Now Flying!" home section. A sonde appears here only while still airborne; it disappears once landed. `fetchTodayFlights(todayStr)` is the higher-level helper actually used by the UI: it unions today's live sondes with today's already-landed ones (derived from `fetchRadiosondyFeatures` on the current month, parsing `Altitude:`/`Climbing:` out of `popupContent` since the recovery feed doesn't expose them as structured fields like the live feed does), keyed by sonde number, each tagged `isLive: true/false`. This exists because Wyoming (the official launch-time source) lags well behind real-time — `fetchTodayFlights` is often the only way to know "did a balloon go up today" before Wyoming publishes it.
   - `isInRioGrandeDoNorte()` filters live-feed entries to our station/region (exact `startplace` match or a lat/lon bounding box fallback, in case a flight launched elsewhere drifts over RN).
   - `sondeHubUrl(sondeNumber)` builds an external link to sondehub.org centered on a fixed coordinate near Barreira do Inferno — only the sonde ID varies.
   - Also builds custom Leaflet balloon SVG icons (`buildBalloonIcon`/`buildHighlightBalloonIcon`) color-coded by recovery status.

### Pages

- `app/page.tsx` — minimal entry/redirect.
- `app/historico/page.tsx` — main historical view, and also the home for live status:
  - "Ao vivo" card renders unconditionally as the first thing on the page (not gated on year data having loaded), polling `fetchTodayFlights()` every 20s. Shows per-sonde status (red = `isLive` i.e. still in flight, green = landed), altitude, sonde number, and last-report time converted to GMT-3 24h (`formatGmt3`).
  - Below that: yearly bar chart (Recharts) of launches per month, backed by both server (`/api/sounding?action=year`) and client cache (`app/lib/cache.ts`).
  - Clicking a launch time in the month-by-day grid selects it (`selectedLaunch`) and opens `LaunchMap`; the day-card containing the selected time gets a red border (`selectedLaunch?.date === date`).
- `app/historico/LaunchMap.tsx` — Leaflet map rendering radiosondy.info recovery positions for a past launch.
- `app/configuracoes/page.tsx` — settings: station/region/period config, cache management (export/import/clear), backed by `app/lib/cache.ts`.
- `app/api/cache/route.ts` — thin status/info endpoint; actual cache mutation happens client-side via `localStorage` (this route just confirms intent for UI flows).

### Key invariants to preserve when touching this code

- Station is hardcoded: STNM `82599`, region `naconf`, GMT-3 fixed offset — not user-configurable at the API level even though `configuracoes` UI implies settings.
- Wyoming's `TO=` day param must be a real day-of-month (e.g. never `31` for a 30-day month) or it 400s — see `lastDay` computation in `fetchSounding`. Note Wyoming is also flaky in a second way: the *same* request can non-deterministically omit the most recent observation near a month boundary (observed directly: identical `TO=3023` requests returned 8 vs 9 entries across repeated calls) — this is server-side flakiness, not a bug in our parsing, and self-heals in production because `syncMonth`'s merge is additive and Blob-persisted (never overwrites with less data); it does *not* self-heal locally without Blob credentials, since each request restarts from an empty store.
- Don't fetch whole months on every request — always go through `syncMonth`'s incremental "fetch from last stored day" pattern.
- Server memory cache and client localStorage cache are independent layers; a fix in one does not propagate to the other.
- radiosondy.info's live feed (`export_map.php?live_map=1`) returns `report` timestamps with a lowercase trailing `z` (e.g. `"2026-06-23 12:57:32z"`) — appending another `Z` for `Date` parsing produces an invalid date silently. Always strip the existing `z`/`Z` before re-appending one (see `gmt3DateStr`/`formatGmt3` for the correct pattern).
