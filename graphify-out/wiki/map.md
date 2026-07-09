# map

> God node · 18 connections · [C:\Users\rudso\OneDrive\Documentos\Site_sonda\sondas\app\painel\components\MissionMap.tsx](file:///C:/Users/rudso/OneDrive/Documentos/Site_sonda/sondas/app/painel/components/MissionMap.tsx#L132)

## Call Trace Diagram

```mermaid
sequenceDiagram
    participant P0 as map
    participant P1 as GET()
    participant P2 as now
    participant P3 as fetchInventory()
    participant P4 as fetchSingleSounding()
    participant P5 as writeCache()
    participant P6 as fetchSondeHubFlights()
    participant P7 as sync()
    participant P8 as nowGMT3()
    participant P9 as isWithinMatchWindow()
    participant P10 as formatWhen()
    participant P11 as computeConfidence()
    participant P12 as fetchWyomingMonth()
    participant P13 as parseInventory()
    participant P14 as fetchWithTimeout()
    participant P15 as fetchApproxLaunches()
    participant P16 as syncMonth()
    participant P17 as DELETE()
    participant P18 as fetchComplementaryLaunches()
    participant P19 as fetchRadiosondyFeatures()
    participant P20 as getCacheStatsByStation()
    participant P21 as listYearStores()
    participant P22 as readYearStore()
    participant P23 as fetchSondeHubArchiveFramesForDay()
    participant P24 as analyzeTrajectory()
    participant P25 as writeYearStore()
    participant P26 as findStation()
    participant P27 as fetchArchiveTrajectory()
    participant P28 as writeSyncStatus()
    participant P29 as readSyncStatus()
    participant P30 as fetchLiveTrajectory()
    participant P31 as launchUtcInstant()
    participant P32 as parsePopupTelemetry()
    participant P33 as pointsFromFrames()
    participant P34 as sanitizeStore()
    participant P35 as findRecoveredMatch()
    participant P36 as findLiveMatch()
    participant P37 as landingDensity()
    participant P38 as redraw()
    participant P39 as loadTrajectory()
    participant P40 as fetchSondeHubApproxLaunches()
    participant P41 as run()
    participant P42 as drawTrajectory()
    participant P43 as parseS3List()
    participant P44 as getCacheStats()
    participant P45 as createBaseMap()
    participant P46 as SummaryCards()
    P0->>+ P1: calls
    P1-->>- P0: return
    P1->>+ P0: calls
    P0-->>- P1: return
    P1->>+ P2: calls
    P2-->>- P1: return
    P2->>+ P1: calls
    P1-->>- P2: return
    P2->>+ P3: calls
    P3-->>- P2: return
    P2->>+ P4: calls
    P4-->>- P2: return
    P2->>+ P5: calls
    P5-->>- P2: return
    P2->>+ P6: calls
    P6-->>- P2: return
    P2->>+ P7: calls
    P7-->>- P2: return
    P2->>+ P8: calls
    P8-->>- P2: return
    P2->>+ P9: calls
    P9-->>- P2: return
    P2->>+ P10: calls
    P10-->>- P2: return
    P2->>+ P11: calls
    P11-->>- P2: return
    P1->>+ P3: calls
    P3-->>- P1: return
    P3->>+ P1: calls
    P1-->>- P3: return
    P3->>+ P2: calls
    P2-->>- P3: return
    P3->>+ P12: calls
    P12-->>- P3: return
    P3->>+ P8: calls
    P8-->>- P3: return
    P3->>+ P13: calls
    P13-->>- P3: return
    P3->>+ P14: calls
    P14-->>- P3: return
    P1->>+ P15: calls
    P15-->>- P1: return
    P1->>+ P16: calls
    P16-->>- P1: return
    P1->>+ P17: calls
    P17-->>- P1: return
    P1->>+ P18: calls
    P18-->>- P1: return
    P1->>+ P19: calls
    P19-->>- P1: return
    P1->>+ P20: calls
    P20-->>- P1: return
    P1->>+ P4: calls
    P4-->>- P1: return
    P1->>+ P12: calls
    P12-->>- P1: return
    P1->>+ P21: calls
    P21-->>- P1: return
    P1->>+ P22: calls
    P22-->>- P1: return
    P1->>+ P23: calls
    P23-->>- P1: return
    P1->>+ P24: calls
    P24-->>- P1: return
    P1->>+ P25: calls
    P25-->>- P1: return
    P1->>+ P26: calls
    P26-->>- P1: return
    P1->>+ P27: calls
    P27-->>- P1: return
    P1->>+ P8: calls
    P8-->>- P1: return
    P1->>+ P28: calls
    P28-->>- P1: return
    P1->>+ P29: calls
    P29-->>- P1: return
    P1->>+ P30: calls
    P30-->>- P1: return
    P1->>+ P31: calls
    P31-->>- P1: return
    P1->>+ P32: calls
    P32-->>- P1: return
    P1->>+ P9: calls
    P9-->>- P1: return
    P1->>+ P33: calls
    P33-->>- P1: return
    P1->>+ P34: calls
    P34-->>- P1: return
    P1->>+ P35: calls
    P35-->>- P1: return
    P1->>+ P36: calls
    P36-->>- P1: return
    P1->>+ P37: calls
    P37-->>- P1: return
    P0->>+ P38: calls
    P38-->>- P0: return
    P0->>+ P39: calls
    P39-->>- P0: return
    P0->>+ P16: calls
    P16-->>- P0: return
    P0->>+ P40: calls
    P40-->>- P0: return
    P0->>+ P17: calls
    P17-->>- P0: return
    P0->>+ P20: calls
    P20-->>- P0: return
    P0->>+ P12: calls
    P12-->>- P0: return
    P0->>+ P41: calls
    P41-->>- P0: return
    P0->>+ P27: calls
    P27-->>- P0: return
    P0->>+ P42: calls
    P42-->>- P0: return
    P0->>+ P43: calls
    P43-->>- P0: return
    P0->>+ P30: calls
    P30-->>- P0: return
    P0->>+ P44: calls
    P44-->>- P0: return
    P0->>+ P45: calls
    P45-->>- P0: return
    P0->>+ P33: calls
    P33-->>- P0: return
    P0->>+ P46: calls
    P46-->>- P0: return
```

## Connections by Relation

### calls
- [[GET()]] `INFERRED`
- [[redraw()]] `EXTRACTED`
- [[loadTrajectory()]] `EXTRACTED`
- [[syncMonth()]] `INFERRED`
- [[fetchSondeHubApproxLaunches()]] `INFERRED`
- [[DELETE()]] `INFERRED`
- [[getCacheStatsByStation()]] `INFERRED`
- [[fetchWyomingMonth()]] `INFERRED`
- [[run()]] `INFERRED`
- [[fetchArchiveTrajectory()]] `INFERRED`
- [[drawTrajectory()]] `INFERRED`
- [[parseS3List()]] `INFERRED`
- [[fetchLiveTrajectory()]] `INFERRED`
- [[getCacheStats()]] `INFERRED`
- [[createBaseMap()]] `INFERRED`
- [[pointsFromFrames()]] `INFERRED`
- [[SummaryCards()]] `INFERRED`

### contains
- [[MissionMap.tsx]] `EXTRACTED`

---

*Part of the graphify knowledge wiki. See [[index]] to navigate.*