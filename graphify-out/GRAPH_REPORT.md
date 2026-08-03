# Graph Report - sondas  (2026-07-31)

## Corpus Check
- 112 files · ~66,506 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 885 nodes · 2147 edges · 52 communities (48 shown, 4 thin omitted)
- Extraction: 94% EXTRACTED · 6% INFERRED · 0% AMBIGUOUS · INFERRED: 120 edges (avg confidence: 0.78)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `cba53779`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- sounding/route.ts
- painel/page.tsx
- radiosondy.ts
- LocalCachePanel.tsx
- MissionMap.tsx
- bucket
- Shell.tsx
- TopStatusBar.tsx
- PowerTimeline.tsx
- R2Panel.tsx
- StationCompare.tsx
- ChasePanel.tsx
- YearMap.tsx
- LiveCard.tsx
- MonthAccordion.tsx
- receiverKey
- ConfidencePanel.tsx
- dependencies
- sondehub.ts
- compilerOptions
- stations.ts
- BatteryChart.tsx
- OledScreenEditor.tsx
- Station
- MonthlyChart.tsx
- blobStore.ts
- Launch
- next.config.js
- FlightMetricsCards.tsx
- LaunchMap.tsx
- receiver-config/request/route.ts
- analytics/page.tsx
- GET
- receiver-screens/request/route.ts
- types.ts
- Sondas Natal 🛰️
- Architecture
- mqtt-fake-publish.mjs
- readFirmwareMeta
- receiver-history/route.ts
- receiver-config/snapshot/route.ts
- receiver-screens/snapshot/route.ts
- readKnownReceivers
- readFirmwareBinary
- Bateria do TTGO via MQTT — nativo no firmware dev2 (patch aposentado)
- poll/route.ts
- vercel.json
- leaflet-css.d.ts

## God Nodes (most connected - your core abstractions)
1. `GET()` - 34 edges
2. `getClient()` - 31 edges
3. `bucket()` - 31 edges
4. `receiverKey()` - 30 edges
5. `Station` - 25 edges
6. `Launch` - 25 edges
7. `getSettings()` - 21 edges
8. `map` - 18 edges
9. `compilerOptions` - 16 edges
10. `refreshLiveFlightsCache()` - 15 edges

## Surprising Connections (you probably didn't know these)
- `all` --calls--> `DELETE()`  [INFERRED]
  app/analytics/components/StationCompare.tsx → app/api/r2-admin/route.ts
- `onFocus()` --calls--> `getSelectedStation()`  [INFERRED]
  app/components/Shell.tsx → app/lib/stations.ts
- `DELETE()` --calls--> `map`  [INFERRED]
  app/api/r2-admin/route.ts → app/painel/components/MissionMap.tsx
- `fetchInventory()` --calls--> `nowGMT3()`  [INFERRED]
  app/api/sounding/route.ts → app/lib/types.ts
- `fetchInventory()` --calls--> `now`  [INFERRED]
  app/api/sounding/route.ts → app/painel/page.tsx

## Import Cycles
- None detected.

## Communities (52 total, 4 thin omitted)

### Community 0 - "sounding/route.ts"
Cohesion: 0.13
Nodes (34): checkWyomingDataAvailable(), DEFAULT_STATION_ID, fetchApproxLaunches(), fetchComplementaryLaunches(), fetchInventory(), fetchSingleSounding(), fetchWithTimeout(), fetchWyomingMonth() (+26 more)

### Community 1 - "painel/page.tsx"
Cohesion: 0.09
Nodes (24): byMonth, { data, setData, error, statusMsg, syncing, fetchData, syncMonths }, [deleteMonthConfirm, setDeleteMonthConfirm], [deleteYearConfirm, setDeleteYearConfirm], [expandedMonth, setExpandedMonth], handleConfirmDeleteMonth, handleConfirmDeleteYear, [noMatchLaunches, setNoMatchLaunchesState] (+16 more)

### Community 2 - "radiosondy.ts"
Cohesion: 0.13
Nodes (24): run(), isDaytimeHour(), ApproxLaunch, balloonIconCounter, balloonSvgMarkup(), buildBalloonIcon(), buildHighlightBalloonIcon(), buildHighlightLiveBalloonIcon() (+16 more)

### Community 3 - "LocalCachePanel.tsx"
Cohesion: 0.10
Nodes (39): [bulkSyncFrom, setBulkSyncFrom], [bulkSyncStatus, setBulkSyncStatus], [cacheSizeBytes, setCacheSizeBytes], [cacheStats, setCacheStats], [cacheStatsByStation, setCacheStatsByStation], currentYear, DeleteConfirm, [deleteConfirm, setDeleteConfirm] (+31 more)

### Community 4 - "MissionMap.tsx"
Cohesion: 0.09
Nodes (22): BaseMap, createBaseMap(), DAY_NIGHT, POWER_STATE, SOURCE_COLORS, STATUS_COLORS, TRAJECTORY, antennaIconMarkup() (+14 more)

### Community 5 - "bucket"
Cohesion: 0.25
Nodes (16): DELETE(), GET(), bucket(), deleteJsonKey(), deleteR2Object(), deleteYearStore(), getClient(), getYearStoreSize() (+8 more)

### Community 6 - "Shell.tsx"
Cohesion: 0.15
Nodes (11): active, navItems, onFocus(), pathname, Shell(), shortName, [sidebarOpen, setSidebarOpen], [station, setStation] (+3 more)

### Community 7 - "TopStatusBar.tsx"
Cohesion: 0.15
Nodes (15): max, TodayData, cycle, fmtCountdown(), gmt3, gmt3Str, hadFlightToday, landedCount (+7 more)

### Community 8 - "PowerTimeline.tsx"
Cohesion: 0.06
Nodes (49): POWER_COLORS, configTxtFromChanges(), isSensitiveKey(), parseConfigTxt(), RdzConfig, RdzConfigValue, SENSITIVE_KEYS, RDZ_CONFIG_SECTIONS (+41 more)

### Community 9 - "R2Panel.tsx"
Cohesion: 0.10
Nodes (21): [configured, setConfigured], [deleteConfirm, setDeleteConfirm], DeleteTarget, [deleting, setDeleting], [expandedStations, setExpandedStations], fetchFiles, FILE_DESCRIPTIONS, fileBasename() (+13 more)

### Community 10 - "StationCompare.tsx"
Cohesion: 0.15
Nodes (14): [adding, setAdding], addStation, all, baseEntry, chartData, COMPARE_COLORS, CompareEntry, [entries, setEntries] (+6 more)

### Community 11 - "ChasePanel.tsx"
Cohesion: 0.21
Nodes (15): GeoState, googleMapsNavUrl(), useGeolocation(), wazeNavUrl(), bearingDeg(), bearingToCardinal(), CARDINALS, formatDistance() (+7 more)

### Community 12 - "YearMap.tsx"
Cohesion: 0.13
Nodes (16): fetchFromCache(), useLiveFlights(), BALLOON_SIZE, cancelled, containerRef, [error, setError], mapDivRef, mapRef (+8 more)

### Community 13 - "LiveCard.tsx"
Cohesion: 0.23
Nodes (12): count, hadFlightToday, LiveCard(), todayMonth, formatGmt3(), isDaytime(), parseUtcDateStr(), sameLaunch() (+4 more)

### Community 14 - "MonthAccordion.tsx"
Cohesion: 0.19
Nodes (13): days, isOpen, key, launches, m, MonthAccordion(), next, NoMatchNotice (+5 more)

### Community 15 - "receiverKey"
Cohesion: 0.06
Nodes (74): POST(), useTodayData(), ReceiverLiveStatus, upsertKnownReceiver(), writeInstalledFirmware(), computeCfgAuth(), randomReqId(), num() (+66 more)

### Community 16 - "ConfidencePanel.tsx"
Cohesion: 0.19
Nodes (13): SourceBadges(), SourceBadgesProps, SOURCES, stateLabel(), computeConfidence(), LaunchConfidence, SEVEN_DAYS_MS, SourceState (+5 more)

### Community 17 - "dependencies"
Cohesion: 0.04
Nodes (44): autoprefixer, @aws-sdk/client-s3, leaflet, lucide-react, next, dependencies, @aws-sdk/client-s3, leaflet (+36 more)

### Community 18 - "sondehub.ts"
Cohesion: 0.14
Nodes (28): writeLiveFlights(), gmt3DateStr(), LiveFlightsCacheSummary, refreshLiveFlightsCache(), todayStr(), fetchLiveFlights(), fetchRadiosondyFeatures(), fetchTodayFlights() (+20 more)

### Community 19 - "compilerOptions"
Cohesion: 0.07
Nodes (26): dom, dom.iterable, esnext, next-env.d.ts, .next/types/**/*.ts, node_modules, **/*.ts, **/*.tsx (+18 more)

### Community 20 - "stations.ts"
Cohesion: 0.21
Nodes (13): AnalyticsPage(), ConfiguracoesPage(), isSelected, [query, setQuery], results, StationPicker(), landingDensity(), DIACRITICS_REGEX (+5 more)

### Community 21 - "BatteryChart.tsx"
Cohesion: 0.16
Nodes (24): BattVoltageEntry, shouldRecordBattReading(), BatteryChart(), BatteryChartProps, ChartPoint, dayEndUtcMs(), dayLabel(), dayLabelShort() (+16 more)

### Community 22 - "OledScreenEditor.tsx"
Cohesion: 0.14
Nodes (18): MOCK_TELEMETRY, drawOledEntry(), formatEntry(), Formatted, FormattedEntry, FormattedQBar, sign(), IGNORED_PREFIXES (+10 more)

### Community 23 - "Station"
Cohesion: 0.28
Nodes (7): LandingHeatmap(), LandingHeatmapProps, StationCompareProps, MonthAccordionProps, StationPickerProps, LandingCell, Station

### Community 24 - "MonthlyChart.tsx"
Cohesion: 0.33
Nodes (4): chartData, MonthlyChart(), MonthlyChartProps, MONTHS

### Community 25 - "blobStore.ts"
Cohesion: 0.12
Nodes (20): GET(), GET(), ConfigRequest, ConfigResult, ConfigSnapshot, DEFAULT_STATION_ID, FirmwareMeta, InstalledFirmware (+12 more)

### Community 26 - "Launch"
Cohesion: 0.30
Nodes (10): LiveCardProps, LaunchMapProps, LiveFlightsSnapshot, TodayFlight, Launch, isSelected, LivePanelProps, pos (+2 more)

### Community 29 - "FlightMetricsCards.tsx"
Cohesion: 0.32
Nodes (5): FlightMetricsCards(), Stat(), StatProps, SummaryCards(), YearData

### Community 30 - "LaunchMap.tsx"
Cohesion: 0.21
Nodes (17): drawTrajectory(), BALLOON_SIZE, LaunchMap(), externalRadiosondyUrl(), lastDayOfMonth(), fetchSondeHubArchiveFramesForDay(), fetchSondeHubArchiveSondeForDay(), parseS3List() (+9 more)

### Community 31 - "receiver-config/request/route.ts"
Cohesion: 0.22
Nodes (14): DELETE(), GET(), POST(), GET(), POST(), configRequestPath(), configResultPath(), deleteConfigRequest() (+6 more)

### Community 32 - "analytics/page.tsx"
Cohesion: 0.14
Nodes (13): data, DriftRose(), OCTANTS, cells, [launches, setLaunches], [loading, setLoading], metrics, currentYear (+5 more)

### Community 34 - "GET"
Cohesion: 0.36
Nodes (13): GET(), maxDuration, GET(), writeSyncStatus(), findLiveMatch(), findRecoveredMatch(), isWithinMatchWindow(), launchUtcInstant() (+5 more)

### Community 35 - "receiver-screens/request/route.ts"
Cohesion: 0.24
Nodes (12): DELETE(), GET(), POST(), GET(), POST(), deleteScreensRequest(), readScreensRequest(), readScreensResult() (+4 more)

### Community 36 - "types.ts"
Cohesion: 0.18
Nodes (11): formatWhen(), SyncStatusPanel(), FlightStats, KnownReceiverEntry, LaunchPosition, LaunchSources, PollStatus, SourceId (+3 more)

### Community 37 - "Sondas Natal 🛰️"
Cohesion: 0.15
Nodes (12): Cliente (Browser), Deploy no Vercel, Desenvolvimento local, Estação padrão, Estratégia de Cache, Fonte dos dados, Funcionalidades, Licença (+4 more)

### Community 38 - "Architecture"
Cohesion: 0.18
Nodes (9): Architecture, Background radiosondy-match sync (`app/api/radiosondy-sync/route.ts`), Commands, Data flow (Wyoming launch history), Key invariants to preserve when touching this code, Mission control refactor (branch mission-control), Multi-station support, Pages (+1 more)

### Community 39 - "mqtt-fake-publish.mjs"
Cohesion: 0.24
Nodes (10): args, client, homeLat, homeLon, pub(), publishPacket(), publishStation(), sleepIdx (+2 more)

### Community 40 - "readFirmwareMeta"
Cohesion: 0.31
Nodes (8): GET(), POST(), GET(), firmwareMetaPath(), installedVersionPath(), readFirmwareMeta(), readInstalledFirmware(), writeFirmwareBinary()

### Community 41 - "receiver-history/route.ts"
Cohesion: 0.42
Nodes (8): DELETE(), GET(), parseType(), PUT(), deleteReceiverHistory(), readReceiverHistory(), receiverHistoryPath(), writeReceiverHistory()

### Community 42 - "receiver-config/snapshot/route.ts"
Cohesion: 0.53
Nodes (5): GET(), POST(), configSnapshotPath(), readConfigSnapshot(), writeConfigSnapshot()

### Community 43 - "receiver-screens/snapshot/route.ts"
Cohesion: 0.53
Nodes (5): GET(), POST(), readScreensSnapshot(), screensSnapshotPath(), writeScreensSnapshot()

### Community 44 - "readKnownReceivers"
Cohesion: 0.70
Nodes (4): DELETE(), GET(), deleteKnownReceiver(), readKnownReceivers()

### Community 45 - "readFirmwareBinary"
Cohesion: 0.67
Nodes (3): GET(), firmwareBinPath(), readFirmwareBinary()

### Community 46 - "Bateria do TTGO via MQTT — nativo no firmware dev2 (patch aposentado)"
Cohesion: 0.50
Nodes (3): Bateria do TTGO via MQTT — nativo no firmware dev2 (patch aposentado), Deep sleep v2 (fork local), O que é preciso configurar

## Knowledge Gaps
- **298 isolated node(s):** `OCTANTS`, `COMPARE_COLORS`, `memoryCache`, `inventoryCache`, `MONTH_MAP` (+293 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `getSettings()` connect `receiverKey` to `R2Panel.tsx`, `stations.ts`, `painel/page.tsx`?**
  _High betweenness centrality (0.034) - this node is a cross-community bridge._
- **Why does `Station` connect `Station` to `analytics/page.tsx`, `sounding/route.ts`, `painel/page.tsx`, `LocalCachePanel.tsx`, `MissionMap.tsx`, `Shell.tsx`, `TopStatusBar.tsx`, `StationCompare.tsx`, `ChasePanel.tsx`, `YearMap.tsx`, `MonthAccordion.tsx`, `receiverKey`, `ConfidencePanel.tsx`, `stations.ts`, `Launch`?**
  _High betweenness centrality (0.024) - this node is a cross-community bridge._
- **Why does `receiverKey()` connect `receiverKey` to `receiver-screens/snapshot/route.ts`, `receiver-config/snapshot/route.ts`, `receiver-screens/request/route.ts`, `receiver-config/request/route.ts`?**
  _High betweenness centrality (0.021) - this node is a cross-community bridge._
- **Are the 22 inferred relationships involving `GET()` (e.g. with `listYearStores()` and `readSyncStatus()`) actually correct?**
  _`GET()` has 22 INFERRED edges - model-reasoned connections that need verification._
- **What connects `OCTANTS`, `COMPARE_COLORS`, `memoryCache` to the rest of the system?**
  _298 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `sounding/route.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.13445378151260504 - nodes in this community are weakly interconnected._
- **Should `painel/page.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.08923076923076922 - nodes in this community are weakly interconnected._