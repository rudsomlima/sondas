# Graph Report - sondas  (2026-09-13)

## Corpus Check
- 115 files · ~75,101 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 938 nodes · 2313 edges · 54 communities (51 shown, 3 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 108 edges (avg confidence: 0.78)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `f6bc39dc`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- sondehub.ts
- historico/page.tsx
- radiosondy.ts
- LocalCachePanel.tsx
- MissionMap.tsx
- bucket
- Shell.tsx
- MonthAccordion.tsx
- PowerTimeline.tsx
- meu-receptor/page.tsx
- StationCompare.tsx
- ChasePanel.tsx
- YearMap.tsx
- SleepConfigEditor.tsx
- FullConfigEditor.tsx
- useReceiver.ts
- LaunchMap.tsx
- dependencies
- receiver-screens/request/route.ts
- compilerOptions
- stations.ts
- MonthlyChart.tsx
- OledScreenEditor.tsx
- painel/page.tsx
- BatteryChart.tsx
- blobStore.ts
- Station
- next.config.js
- types.ts
- Fontes de dados e estratégia de redundância
- receiverKey
- R2Panel.tsx
- redraw
- receiver-history/route.ts
- receiver-screens/snapshot/route.ts
- Sondas Natal 🛰️
- Arquitetura
- mqtt-fake-publish.mjs
- upload/route.ts
- useLiveFlights.ts
- tokens.ts
- FirmwareOtaPanel.tsx
- TopStatusBar.tsx
- ConfidencePanel.tsx
- Bateria e energia do TTGO — reporte HTTP direto (não MQTT)
- Launch
- vercel.json
- leaflet-css.d.ts
- launchUtils.ts
- DataCoveragePanel.tsx

## God Nodes (most connected - your core abstractions)
1. `GET()` - 34 edges
2. `getClient()` - 32 edges
3. `bucket()` - 32 edges
4. `receiverKey()` - 30 edges
5. `Launch` - 30 edges
6. `Station` - 25 edges
7. `getSettings()` - 21 edges
8. `nowGMT3()` - 19 edges
9. `map` - 18 edges
10. `refreshLiveFlightsCache()` - 16 edges

## Surprising Connections (you probably didn't know these)
- `all` --calls--> `DELETE()`  [INFERRED]
  app/analytics/components/StationCompare.tsx → app/api/r2-admin/route.ts
- `onFocus()` --calls--> `getSelectedStation()`  [INFERRED]
  app/components/Shell.tsx → app/lib/stations.ts
- `DELETE()` --calls--> `map`  [INFERRED]
  app/api/r2-admin/route.ts → app/painel/components/MissionMap.tsx
- `syncMonth()` --calls--> `map`  [INFERRED]
  app/api/sounding/route.ts → app/painel/components/MissionMap.tsx
- `GET()` --calls--> `listYearStores()`  [INFERRED]
  app/api/sync-status/route.ts → app/lib/blobStore.ts

## Import Cycles
- None detected.

## Communities (54 total, 3 thin omitted)

### Community 0 - "sondehub.ts"
Cohesion: 0.06
Nodes (82): GET(), GET(), maxDuration, checkWyomingDataAvailable(), DEFAULT_STATION_ID, fetchApproxLaunches(), fetchComplementaryLaunches(), fetchInventory() (+74 more)

### Community 1 - "historico/page.tsx"
Cohesion: 0.14
Nodes (13): byMonth, currentYear, { data, setData, error, statusMsg, syncing, fetchData, syncMonths }, [deleteMonthConfirm, setDeleteMonthConfirm], [deleteYearConfirm, setDeleteYearConfirm], [expandedMonth, setExpandedMonth], handleConfirmDeleteMonth, handleConfirmDeleteYear (+5 more)

### Community 2 - "radiosondy.ts"
Cohesion: 0.11
Nodes (21): LaunchMap(), isDaytimeHour(), ApproxLaunch, balloonIconCounter, escapePopupHtml(), externalRadiosondyUrl(), GMT3, gmt3DateStr() (+13 more)

### Community 3 - "LocalCachePanel.tsx"
Cohesion: 0.07
Nodes (56): FlightMetricsCards(), Stat(), StatProps, [bulkSyncFrom, setBulkSyncFrom], [bulkSyncStatus, setBulkSyncStatus], [cacheSizeBytes, setCacheSizeBytes], [cacheStats, setCacheStats], [cacheStatsByStation, setCacheStatsByStation] (+48 more)

### Community 4 - "MissionMap.tsx"
Cohesion: 0.13
Nodes (18): BaseMap, createBaseMap(), antennaIconMarkup(), BALLOON_SIZE, cancelled, chaseLayerRef, escapeHtml(), init() (+10 more)

### Community 5 - "bucket"
Cohesion: 0.18
Nodes (23): DELETE(), GET(), DELETE(), GET(), bucket(), deleteJsonKey(), deleteKnownReceiver(), deleteR2Object() (+15 more)

### Community 6 - "Shell.tsx"
Cohesion: 0.15
Nodes (11): active, navItems, onFocus(), pathname, Shell(), shortName, [sidebarOpen, setSidebarOpen], [station, setStation] (+3 more)

### Community 7 - "MonthAccordion.tsx"
Cohesion: 0.22
Nodes (10): days, isOpen, key, launches, m, MonthAccordion(), next, NoMatchNotice (+2 more)

### Community 8 - "PowerTimeline.tsx"
Cohesion: 0.13
Nodes (21): POWER_COLORS, PowerHistoryState, ALL_DETAIL_STATES, clampRange(), computeDailyTimelines(), computeTicks(), DaySegment, DayTimeline (+13 more)

### Community 9 - "meu-receptor/page.tsx"
Cohesion: 0.19
Nodes (18): computeCfgAuth(), randomReqId(), parseConfigJson(), AppSettings, DEFAULT_SETTINGS, getSettings(), KnownReceiver, setSettings() (+10 more)

### Community 10 - "StationCompare.tsx"
Cohesion: 0.15
Nodes (12): [adding, setAdding], addStation, all, baseEntry, chartData, COMPARE_COLORS, CompareEntry, [entries, setEntries] (+4 more)

### Community 11 - "ChasePanel.tsx"
Cohesion: 0.16
Nodes (20): AnalyticsPage(), GeoState, googleMapsNavUrl(), useGeolocation(), wazeNavUrl(), bearingDeg(), bearingToCardinal(), CARDINALS (+12 more)

### Community 12 - "YearMap.tsx"
Cohesion: 0.13
Nodes (13): BALLOON_SIZE, cancelled, containerRef, [error, setError], mapDivRef, MapPoint, mapRef, markersLayerRef (+5 more)

### Community 13 - "SleepConfigEditor.tsx"
Cohesion: 0.15
Nodes (17): hhmmToMinutes(), minutesToHHMM(), parseSleepWindows(), SleepWindow, buildPreviewSegments(), BuiltSeg, computeAxisTicks(), EXTEND_MODE_LABELS (+9 more)

### Community 14 - "FullConfigEditor.tsx"
Cohesion: 0.15
Nodes (17): configTxtFromChanges(), isSensitiveKey(), parseConfigTxt(), RdzConfig, RdzConfigValue, SENSITIVE_KEYS, RDZ_CONFIG_SECTIONS, RDZ_FIELD_META (+9 more)

### Community 15 - "useReceiver.ts"
Cohesion: 0.09
Nodes (51): POST(), ReceiverLiveStatus, num(), parseRdzPmu(), parseRdzPower(), parseRdzSleep(), RdzPmu, RdzPower (+43 more)

### Community 16 - "LaunchMap.tsx"
Cohesion: 0.26
Nodes (13): drawTrajectory(), BALLOON_SIZE, analyzeTrajectory(), downsample(), fetchArchiveTrajectory(), fetchLiveTrajectory(), FlightAnalysis, frameToPoint() (+5 more)

### Community 17 - "dependencies"
Cohesion: 0.04
Nodes (44): autoprefixer, @aws-sdk/client-s3, leaflet, lucide-react, next, dependencies, @aws-sdk/client-s3, leaflet (+36 more)

### Community 18 - "receiver-screens/request/route.ts"
Cohesion: 0.23
Nodes (13): DELETE(), GET(), POST(), GET(), POST(), deleteScreensRequest(), readScreensRequest(), readScreensResult() (+5 more)

### Community 19 - "compilerOptions"
Cohesion: 0.07
Nodes (26): dom, dom.iterable, esnext, next-env.d.ts, .next/types/**/*.ts, node_modules, **/*.ts, **/*.tsx (+18 more)

### Community 20 - "stations.ts"
Cohesion: 0.24
Nodes (11): ConfiguracoesPage(), isSelected, [query, setQuery], results, StationPicker(), DIACRITICS_REGEX, getSelectedStation(), normalize() (+3 more)

### Community 21 - "MonthlyChart.tsx"
Cohesion: 0.18
Nodes (8): data, DriftRose(), OCTANTS, chartData, MonthlyChart(), MonthlyChartProps, MONTHS, CHART

### Community 22 - "OledScreenEditor.tsx"
Cohesion: 0.12
Nodes (24): MOCK_TELEMETRY, MOCK_TELEMETRY_MAX, drawOledEntry(), formatEntry(), Formatted, FormattedEntry, FormattedQBar, maxWidthChars() (+16 more)

### Community 23 - "painel/page.tsx"
Cohesion: 0.11
Nodes (20): cells, [launches, setLaunches], [loading, setLoading], metrics, [year, setYear], years, cached, cancelled (+12 more)

### Community 24 - "BatteryChart.tsx"
Cohesion: 0.31
Nodes (12): BatteryChart(), ChartPoint, dayEndUtcMs(), dayLabel(), dayLabelShort(), dayStartUtcMs(), fmtTime(), lineColor() (+4 more)

### Community 25 - "blobStore.ts"
Cohesion: 0.11
Nodes (21): GET(), GET(), ConfigRequest, ConfigResult, ConfigSnapshot, DEFAULT_STATION_ID, FirmwareMeta, InstalledFirmware (+13 more)

### Community 26 - "Station"
Cohesion: 0.24
Nodes (8): LandingHeatmap(), LandingHeatmapProps, StationCompareProps, MonthAccordionProps, StationPickerProps, LandingCell, Station, TopStatusBarProps

### Community 29 - "types.ts"
Cohesion: 0.16
Nodes (12): formatWhen(), SyncStatusPanel(), FlightStats, KnownReceiverEntry, LaunchPosition, LaunchSources, PollStatus, SourceId (+4 more)

### Community 30 - "Fontes de dados e estratégia de redundância"
Cohesion: 0.25
Nodes (7): Fontes de dados e estratégia de redundância, NOAA/NCEI IGRA 2.2 — próximo fallback recomendado, Ordem de consulta, radiosondy.info, Semântica de falha, SondeHub v2 — API pública documentada, University of Wyoming

### Community 31 - "receiverKey"
Cohesion: 0.19
Nodes (19): DELETE(), GET(), POST(), GET(), POST(), GET(), POST(), configRequestPath() (+11 more)

### Community 32 - "R2Panel.tsx"
Cohesion: 0.10
Nodes (21): [configured, setConfigured], [deleteConfirm, setDeleteConfirm], DeleteTarget, [deleting, setDeleting], [expandedStations, setExpandedStations], fetchFiles, FILE_DESCRIPTIONS, fileBasename() (+13 more)

### Community 34 - "redraw"
Cohesion: 0.29
Nodes (10): run(), balloonSvgMarkup(), buildBalloonIcon(), buildHighlightBalloonIcon(), buildHighlightLiveBalloonIcon(), iconLabelMarkup(), parachuteSvgMarkup(), statusColor() (+2 more)

### Community 35 - "receiver-history/route.ts"
Cohesion: 0.42
Nodes (8): DELETE(), GET(), parseType(), PUT(), deleteReceiverHistory(), readReceiverHistory(), receiverHistoryPath(), writeReceiverHistory()

### Community 36 - "receiver-screens/snapshot/route.ts"
Cohesion: 0.53
Nodes (5): GET(), POST(), readScreensSnapshot(), screensSnapshotPath(), writeScreensSnapshot()

### Community 37 - "Sondas Natal 🛰️"
Cohesion: 0.15
Nodes (12): Cliente (Browser), Deploy no Vercel, Desenvolvimento local, Estação padrão, Estratégia de Cache, Fonte dos dados, Funcionalidades, Licença (+4 more)

### Community 38 - "Arquitetura"
Cohesion: 0.12
Nodes (14): Arquitetura, Auto-OTA (`FirmwareOtaPanel.tsx`), Comandos, Config remota completa (`FullConfigEditor.tsx`, `SleepConfigEditor.tsx`), Editor visual de telas OLED (`OledScreenEditor.tsx`), Fluxo de dados (histórico de lançamentos da Wyoming), Integração com radiosondy.info (`app/lib/radiosondy.ts`), Invariantes importantes a preservar ao mexer neste código (+6 more)

### Community 39 - "mqtt-fake-publish.mjs"
Cohesion: 0.24
Nodes (10): args, client, homeLat, homeLon, pub(), publishPacket(), publishStation(), sleepIdx (+2 more)

### Community 40 - "upload/route.ts"
Cohesion: 0.20
Nodes (13): GET(), DELETE(), GET(), POST(), GET(), deleteFirmware(), firmwareBinPath(), firmwareMetaPath() (+5 more)

### Community 41 - "useLiveFlights.ts"
Cohesion: 0.43
Nodes (6): StationCompare(), fetchFromCache(), useLiveFlights(), YearMap(), findStation(), getRadiosondyStartplace()

### Community 42 - "tokens.ts"
Cohesion: 0.33
Nodes (5): DAY_NIGHT, POWER_STATE, SOURCE_COLORS, STATUS_COLORS, TRAJECTORY

### Community 43 - "FirmwareOtaPanel.tsx"
Cohesion: 0.40
Nodes (4): FirmwareMeta, FirmwareOtaPanel(), FirmwareOtaPanelProps, InstalledFirmware

### Community 44 - "TopStatusBar.tsx"
Cohesion: 0.16
Nodes (13): max, cycle, fmtCountdown(), gmt3, gmt3Str, hadFlightToday, landedCount, liveFlight (+5 more)

### Community 45 - "ConfidencePanel.tsx"
Cohesion: 0.19
Nodes (13): SourceBadges(), SourceBadgesProps, SOURCES, stateLabel(), computeConfidence(), LaunchConfidence, SEVEN_DAYS_MS, SourceState (+5 more)

### Community 46 - "Bateria e energia do TTGO — reporte HTTP direto (não MQTT)"
Cohesion: 0.40
Nodes (4): Bateria e energia do TTGO — reporte HTTP direto (não MQTT), O que o firmware reporta, O que é preciso configurar, Testando sem hardware

### Community 47 - "Launch"
Cohesion: 0.33
Nodes (10): LiveCardProps, LaunchMapProps, LiveFlightsSnapshot, TodayFlight, Launch, isSelected, LivePanelProps, pos (+2 more)

### Community 52 - "launchUtils.ts"
Cohesion: 0.21
Nodes (14): count, hadFlightToday, LiveCard(), todayMonth, formatGmt3(), isDaytime(), MONTHS_FULL, parseUtcDateStr() (+6 more)

### Community 53 - "DataCoveragePanel.tsx"
Cohesion: 0.60
Nodes (4): LiveSourceHealth, DataCoveragePanel(), Props, stateClass()

## Knowledge Gaps
- **310 isolated node(s):** `OCTANTS`, `COMPARE_COLORS`, `memoryCache`, `inventoryCache`, `MONTH_MAP` (+305 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `getSettings()` connect `meu-receptor/page.tsx` to `R2Panel.tsx`, `LocalCachePanel.tsx`, `ChasePanel.tsx`, `useReceiver.ts`, `stations.ts`, `painel/page.tsx`, `types.ts`?**
  _High betweenness centrality (0.034) - this node is a cross-community bridge._
- **Why does `Station` connect `Station` to `sondehub.ts`, `historico/page.tsx`, `LocalCachePanel.tsx`, `MissionMap.tsx`, `Shell.tsx`, `MonthAccordion.tsx`, `useLiveFlights.ts`, `StationCompare.tsx`, `ChasePanel.tsx`, `TopStatusBar.tsx`, `ConfidencePanel.tsx`, `Launch`, `stations.ts`, `painel/page.tsx`, `types.ts`?**
  _High betweenness centrality (0.021) - this node is a cross-community bridge._
- **Why does `nowGMT3()` connect `sondehub.ts` to `historico/page.tsx`, `LocalCachePanel.tsx`, `SleepConfigEditor.tsx`, `painel/page.tsx`, `types.ts`?**
  _High betweenness centrality (0.020) - this node is a cross-community bridge._
- **Are the 21 inferred relationships involving `GET()` (e.g. with `listYearStores()` and `readYearStore()`) actually correct?**
  _`GET()` has 21 INFERRED edges - model-reasoned connections that need verification._
- **What connects `OCTANTS`, `COMPARE_COLORS`, `memoryCache` to the rest of the system?**
  _310 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `sondehub.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.061748195669607056 - nodes in this community are weakly interconnected._
- **Should `historico/page.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.14285714285714285 - nodes in this community are weakly interconnected._