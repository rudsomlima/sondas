# Graph Report - C:\Users\rudso\OneDrive\Documentos\Site_sonda\sondas  (2026-07-08)

## Corpus Check
- 57 files · ~31,619 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 364 nodes · 503 edges · 40 communities detected
- Extraction: 79% EXTRACTED · 21% INFERRED · 0% AMBIGUOUS · INFERRED: 106 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]

## God Nodes (most connected - your core abstractions)
1. `GET()` - 34 edges
2. `map` - 18 edges
3. `pad()` - 13 edges
4. `now` - 11 edges
5. `has` - 10 edges
6. `readCache()` - 9 edges
7. `redraw()` - 9 edges
8. `getClient()` - 8 edges
9. `bucket()` - 8 edges
10. `fetchTodayFlights()` - 8 edges

## Surprising Connections (you probably didn't know these)
- `landingDensity()` --calls--> `GET()`  [INFERRED]
  C:\Users\rudso\OneDrive\Documentos\Site_sonda\sondas\app\lib\metrics.ts → C:\Users\rudso\OneDrive\Documentos\Site_sonda\sondas\app\api\sync-status\route.ts
- `formatGmt3()` --calls--> `pad()`  [INFERRED]
  C:\Users\rudso\OneDrive\Documentos\Site_sonda\sondas\app\lib\launchUtils.ts → C:\Users\rudso\OneDrive\Documentos\Site_sonda\sondas\app\painel\components\TopStatusBar.tsx
- `wyomingSoundingUrl()` --calls--> `pad()`  [INFERRED]
  C:\Users\rudso\OneDrive\Documentos\Site_sonda\sondas\app\lib\launchUtils.ts → C:\Users\rudso\OneDrive\Documentos\Site_sonda\sondas\app\painel\components\TopStatusBar.tsx
- `loadTrajectory()` --calls--> `max`  [INFERRED]
  C:\Users\rudso\OneDrive\Documentos\Site_sonda\sondas\app\painel\components\MissionMap.tsx → C:\Users\rudso\OneDrive\Documentos\Site_sonda\sondas\app\analytics\components\DriftRose.tsx
- `DELETE()` --calls--> `all`  [INFERRED]
  C:\Users\rudso\OneDrive\Documentos\Site_sonda\sondas\app\api\r2-admin\route.ts → C:\Users\rudso\OneDrive\Documentos\Site_sonda\sondas\app\analytics\components\StationCompare.tsx

## Communities

### Community 0 - "Community 0"
_Retrieves, parses, caches, and synchronizes radiosonde launch and sounding data for weather reporting._
Cohesion: 0.09
Nodes (35): has, fetchRadiosondyLaunches(), roundToSynopticHour(), toReportStr(), DEFAULT_STATION_ID, fetchApproxLaunches(), fetchComplementaryLaunches(), fetchInventory() (+27 more)

### Community 1 - "Community 1"
_Manages rocket launch scheduling, data synchronization, and month‑based display, including cancellation and confirmation flows._
Cohesion: 0.07
Nodes (32): byMonth, cached, cancelled, cells, changeStation, currentYear, { data, setData, error, statusMsg, syncing, fetchData, syncMonths }, [deleteMonthConfirm, setDeleteMonthConfirm] (+24 more)

### Community 2 - "Community 2"
_Handles fetching radiosonde flight data and rendering live and historical balloon icons and legends on a map interface._
Cohesion: 0.1
Nodes (30): redraw(), balloonIconCounter, balloonSvgMarkup(), buildBalloonIcon(), buildHighlightBalloonIcon(), buildHighlightLiveBalloonIcon(), externalRadiosondyUrl(), fetchLiveFlights() (+22 more)

### Community 3 - "Community 3"
_Manages caching, retrieval, and statistical analysis of weather station data across years and months, and supports confidence calculations and synchronization._
Cohesion: 0.09
Nodes (21): CACHE_KEY, CACHE_VERSION, clearMonth(), clearStation(), clearYear(), DEFAULT_STATION, exportCache(), getCacheByYear() (+13 more)

### Community 4 - "Community 4"

Cohesion: 0.09
Nodes (23): createBaseMap(), BALLOON_SIZE, cancelled, chaseLayerRef, init(), L, layer, leafletRef (+15 more)

### Community 5 - "Community 5"
_Manages CRUD and sync of yearly store data in a bucket, including matching and status tracking operations._
Cohesion: 0.2
Nodes (18): bucket(), DEFAULT_STATION_ID, deleteYearStore(), getClient(), getYearStoreSize(), listYearStores(), pathFor(), readSyncStatus() (+10 more)

### Community 6 - "Community 6"
_Handles station lookup, selection, and UI state for weather balloon launches, enabling navigation and mapping of launch sites._
Cohesion: 0.1
Nodes (18): BALLOON_SIZE, LaunchMap(), active, navItems, onFocus(), pathname, shortName, [sidebarOpen, setSidebarOpen] (+10 more)

### Community 7 - "Community 7"

Cohesion: 0.12
Nodes (13): data, max, OCTANTS, cycle, fmtCountdown(), gmt3, gmt3Str, hadFlightToday (+5 more)

### Community 8 - "Community 8"

Cohesion: 0.13
Nodes (14): [bulkSyncFrom, setBulkSyncFrom], [bulkSyncStatus, setBulkSyncStatus], [cacheSizeBytes, setCacheSizeBytes], [cacheStats, setCacheStats], [cacheStatsByStation, setCacheStatsByStation], currentYear, [deleteConfirm, setDeleteConfirm], [expandedStations, setExpandedStations] (+6 more)

### Community 9 - "Community 9"
_Handles loading, displaying, and modifying a paginated file list with delete support and progress tracking._
Cohesion: 0.17
Nodes (11): [configured, setConfigured], [deleteConfirm, setDeleteConfirm], [deleting, setDeleting], [expandedStations, setExpandedStations], fetchFiles, [files, setFiles], handleDelete, [loaded, setLoaded] (+3 more)

### Community 10 - "Community 10"
_Manages the state and data needed to create, display, and toggle station entries while handling loading status, errors, and chart visualizations._
Cohesion: 0.2
Nodes (8): [adding, setAdding], addStation, baseEntry, chartData, COMPARE_COLORS, [entries, setEntries], [error, setError], [loading, setLoading]

### Community 11 - "Community 11"
_Provides tools for calculating geographic bearings, distances, trajectory analysis, landing density, and annual metrics for flight or navigation data._
Cohesion: 0.24
Nodes (6): bearingDeg(), CARDINALS, haversineKm(), computeYearMetrics(), landingDensity(), analyzeTrajectory()

### Community 12 - "Community 12"
_It manages rendering a map view, handling markers, info balloons, and associated UI state such as error and status._
Cohesion: 0.2
Nodes (9): BALLOON_SIZE, cancelled, containerRef, [error, setError], mapDivRef, mapRef, markersLayerRef, startplace (+1 more)

### Community 13 - "Community 13"
_Handles generation of URLs and formatting for retrieving and interpreting Wyoming weather sounding data and associated date-time information._
Cohesion: 0.22
Nodes (4): formatGmt3(), MONTHS, MONTHS_FULL, wyomingSoundingUrl()

### Community 14 - "Community 14"

Cohesion: 0.29
Nodes (6): days, isOpen, key, launches, m, next

### Community 15 - "Community 15"
_Manages application configuration values, providing defaults and defining storage keys._
Cohesion: 0.4
Nodes (2): DEFAULT_SETTINGS, SETTINGS_KEY

### Community 16 - "Community 16"

Cohesion: 0.4
Nodes (4): conf, launch, level, LEVEL_LABEL

### Community 17 - "Community 17"
_Handles metadata and viewport settings to control how a web page is rendered and displayed on different devices._
Cohesion: 0.5
Nodes (2): metadata, viewport

### Community 18 - "Community 18"

Cohesion: 0.5
Nodes (1): SOURCES

### Community 19 - "Community 19"
_Tracks a user's flight activity for the day, recording how many flights were taken, whether a flight occurred today, and the month._
Cohesion: 0.5
Nodes (3): count, hadFlightToday, todayMonth

### Community 20 - "Community 20"
_Manages query input, selection state, and displays the search results._
Cohesion: 0.5
Nodes (3): isSelected, [query, setQuery], results

### Community 21 - "Community 21"
_Unable to determine domain due to missing code entities._
Cohesion: 0.5
Nodes (0): 

### Community 22 - "Community 22"
_Manages compiling code, creating distributable packages, and configuring deployment targets._
Cohesion: 0.5
Nodes (3): brg, dist, target

### Community 23 - "Community 23"
_Unable to determine domain due to missing code entities._
Cohesion: 0.67
Nodes (0): 

### Community 24 - "Community 24"
_Stores and formats data for generating monthly visualizations._
Cohesion: 0.67
Nodes (2): chartData, MONTHS

### Community 25 - "Community 25"
_Handles mapping of numeric months to full month names for display._
Cohesion: 0.67
Nodes (1): MONTHS_FULL

### Community 26 - "Community 26"
_Keeps track of whether an element is selected and its position within the layout._
Cohesion: 0.67
Nodes (2): isSelected, pos

### Community 27 - "Community 27"
_Defines build‑time and runtime settings for a Next.js application, such as environment variables, routing, and transpilation options._
Cohesion: 1.0
Nodes (1): nextConfig

### Community 28 - "Community 28"
_Unable to determine domain due to missing code entities._
Cohesion: 1.0
Nodes (0): 

### Community 29 - "Community 29"
_Unable to determine domain due to missing code entities._
Cohesion: 1.0
Nodes (0): 

### Community 30 - "Community 30"
_Unable to determine domain due to missing code entities._
Cohesion: 1.0
Nodes (0): 

### Community 31 - "Community 31"
_Unable to determine domain due to missing code entities._
Cohesion: 1.0
Nodes (0): 

### Community 32 - "Community 32"
_Unable to determine domain due to missing code entities._
Cohesion: 1.0
Nodes (0): 

### Community 33 - "Community 33"
_Unable to determine domain due to missing code entities._
Cohesion: 1.0
Nodes (0): 

### Community 34 - "Community 34"
_Unable to determine domain due to missing code entities._
Cohesion: 1.0
Nodes (0): 

### Community 35 - "Community 35"
_Unable to determine domain due to missing code entities._
Cohesion: 1.0
Nodes (0): 

### Community 36 - "Community 36"
_Unable to determine domain due to missing code entities._
Cohesion: 1.0
Nodes (0): 

### Community 37 - "Community 37"
_Unable to determine domain due to missing code entities._
Cohesion: 1.0
Nodes (0): 

### Community 38 - "Community 38"
_Unable to determine domain due to missing code entities._
Cohesion: 1.0
Nodes (0): 

### Community 39 - "Community 39"
_Unable to determine domain due to missing code entities._
Cohesion: 1.0
Nodes (0): 

## Knowledge Gaps
- **158 isolated node(s):** `nextConfig`, `metadata`, `viewport`, `[launches, setLaunches]`, `[loading, setLoading]` (+153 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 27`** (2 nodes): `next.config.js`, `nextConfig`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 28`** (2 nodes): `page.tsx`, `HomePage()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 29`** (2 nodes): `Stat.tsx`, `Stat()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 30`** (2 nodes): `page.tsx`, `ConfiguracoesPage()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 31`** (2 nodes): `useLiveFlights.ts`, `useLiveFlights()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 32`** (2 nodes): `useTodayData.ts`, `useTodayData()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 33`** (1 nodes): `next-env.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 34`** (1 nodes): `postcss.config.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 35`** (1 nodes): `tailwind.config.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 36`** (1 nodes): `leaflet-css.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 37`** (1 nodes): `FlightMetricsCards.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 38`** (1 nodes): `selection.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 39`** (1 nodes): `TelemetryPanel.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.