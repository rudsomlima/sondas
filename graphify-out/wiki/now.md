# now

> God node · 11 connections · [C:\Users\rudso\OneDrive\Documentos\Site_sonda\sondas\app\painel\page.tsx](file:///C:/Users/rudso/OneDrive/Documentos/Site_sonda/sondas/app/painel/page.tsx#L35)

## Call Trace Diagram

```mermaid
sequenceDiagram
    participant P0 as now
    participant P1 as GET()
    participant P2 as map
    participant P3 as redraw()
    participant P4 as loadTrajectory()
    participant P5 as syncMonth()
    participant P6 as fetchSondeHubApproxLaunches()
    participant P7 as DELETE()
    participant P8 as getCacheStatsByStation()
    participant P9 as fetchWyomingMonth()
    participant P10 as run()
    participant P11 as fetchArchiveTrajectory()
    participant P12 as drawTrajectory()
    participant P13 as parseS3List()
    participant P14 as fetchLiveTrajectory()
    participant P15 as getCacheStats()
    participant P16 as createBaseMap()
    participant P17 as pointsFromFrames()
    participant P18 as SummaryCards()
    participant P19 as fetchInventory()
    participant P20 as fetchApproxLaunches()
    participant P21 as fetchComplementaryLaunches()
    participant P22 as fetchRadiosondyFeatures()
    participant P23 as fetchSingleSounding()
    participant P24 as listYearStores()
    participant P25 as readYearStore()
    participant P26 as fetchSondeHubArchiveFramesForDay()
    participant P27 as analyzeTrajectory()
    participant P28 as writeYearStore()
    participant P29 as findStation()
    participant P30 as nowGMT3()
    participant P31 as writeSyncStatus()
    participant P32 as readSyncStatus()
    participant P33 as launchUtcInstant()
    participant P34 as parsePopupTelemetry()
    participant P35 as isWithinMatchWindow()
    participant P36 as sanitizeStore()
    participant P37 as findRecoveredMatch()
    participant P38 as findLiveMatch()
    participant P39 as landingDensity()
    participant P40 as writeCache()
    participant P41 as fetchSondeHubFlights()
    participant P42 as sync()
    participant P43 as formatWhen()
    participant P44 as computeConfidence()
    P0->>+ P1: calls
    P1-->>- P0: return
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
    P2->>+ P12: calls
    P12-->>- P2: return
    P2->>+ P13: calls
    P13-->>- P2: return
    P2->>+ P14: calls
    P14-->>- P2: return
    P2->>+ P15: calls
    P15-->>- P2: return
    P2->>+ P16: calls
    P16-->>- P2: return
    P2->>+ P17: calls
    P17-->>- P2: return
    P2->>+ P18: calls
    P18-->>- P2: return
    P1->>+ P0: calls
    P0-->>- P1: return
    P1->>+ P19: calls
    P19-->>- P1: return
    P1->>+ P20: calls
    P20-->>- P1: return
    P1->>+ P5: calls
    P5-->>- P1: return
    P1->>+ P7: calls
    P7-->>- P1: return
    P1->>+ P21: calls
    P21-->>- P1: return
    P1->>+ P22: calls
    P22-->>- P1: return
    P1->>+ P8: calls
    P8-->>- P1: return
    P1->>+ P23: calls
    P23-->>- P1: return
    P1->>+ P9: calls
    P9-->>- P1: return
    P1->>+ P24: calls
    P24-->>- P1: return
    P1->>+ P25: calls
    P25-->>- P1: return
    P1->>+ P26: calls
    P26-->>- P1: return
    P1->>+ P27: calls
    P27-->>- P1: return
    P1->>+ P28: calls
    P28-->>- P1: return
    P1->>+ P29: calls
    P29-->>- P1: return
    P1->>+ P11: calls
    P11-->>- P1: return
    P1->>+ P30: calls
    P30-->>- P1: return
    P1->>+ P31: calls
    P31-->>- P1: return
    P1->>+ P32: calls
    P32-->>- P1: return
    P1->>+ P14: calls
    P14-->>- P1: return
    P1->>+ P33: calls
    P33-->>- P1: return
    P1->>+ P34: calls
    P34-->>- P1: return
    P1->>+ P35: calls
    P35-->>- P1: return
    P1->>+ P17: calls
    P17-->>- P1: return
    P1->>+ P36: calls
    P36-->>- P1: return
    P1->>+ P37: calls
    P37-->>- P1: return
    P1->>+ P38: calls
    P38-->>- P1: return
    P1->>+ P39: calls
    P39-->>- P1: return
    P0->>+ P19: calls
    P19-->>- P0: return
    P0->>+ P23: calls
    P23-->>- P0: return
    P0->>+ P40: calls
    P40-->>- P0: return
    P0->>+ P41: calls
    P41-->>- P0: return
    P0->>+ P42: calls
    P42-->>- P0: return
    P0->>+ P30: calls
    P30-->>- P0: return
    P0->>+ P35: calls
    P35-->>- P0: return
    P0->>+ P43: calls
    P43-->>- P0: return
    P0->>+ P44: calls
    P44-->>- P0: return
```

## Connections by Relation

### calls
- [[GET()]] `INFERRED`
- [[fetchInventory()]] `INFERRED`
- [[fetchSingleSounding()]] `INFERRED`
- [[writeCache()]] `INFERRED`
- [[fetchSondeHubFlights()]] `INFERRED`
- [[sync()]] `EXTRACTED`
- [[nowGMT3()]] `INFERRED`
- [[isWithinMatchWindow()]] `INFERRED`
- [[formatWhen()]] `INFERRED`
- [[computeConfidence()]] `INFERRED`

### contains
- [[page.tsx]] `EXTRACTED`

---

*Part of the graphify knowledge wiki. See [[index]] to navigate.*