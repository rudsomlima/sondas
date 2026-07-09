# GET()

> God node · 34 connections · [C:\Users\rudso\OneDrive\Documentos\Site_sonda\sondas\app\api\sync-status\route.ts](file:///C:/Users/rudso/OneDrive/Documentos/Site_sonda/sondas/app/api/sync-status/route.ts#L7)

## Call Trace Diagram

```mermaid
sequenceDiagram
    participant P0 as GET()
    participant P1 as map
    participant P2 as redraw()
    participant P3 as has
    participant P4 as buildBalloonIcon()
    participant P5 as buildHighlightLiveBalloonIcon()
    participant P6 as buildHighlightBalloonIcon()
    participant P7 as launchUtcInstant()
    participant P8 as statusColor()
    participant P9 as gmt3IconLabel()
    participant P10 as loadTrajectory()
    participant P11 as fetchArchiveTrajectory()
    participant P12 as analyzeTrajectory()
    participant P13 as fetchLiveTrajectory()
    participant P14 as drawTrajectory()
    participant P15 as max
    participant P16 as syncMonth()
    participant P17 as fetchSondeHubApproxLaunches()
    participant P18 as DELETE()
    participant P19 as getCacheStatsByStation()
    participant P20 as fetchWyomingMonth()
    participant P21 as run()
    participant P22 as parseS3List()
    participant P23 as getCacheStats()
    participant P24 as createBaseMap()
    participant P25 as pointsFromFrames()
    participant P26 as SummaryCards()
    participant P27 as now
    participant P28 as fetchInventory()
    participant P29 as fetchApproxLaunches()
    participant P30 as fetchComplementaryLaunches()
    participant P31 as fetchRadiosondyFeatures()
    participant P32 as fetchSingleSounding()
    participant P33 as listYearStores()
    participant P34 as readYearStore()
    participant P35 as fetchSondeHubArchiveFramesForDay()
    participant P36 as writeYearStore()
    participant P37 as findStation()
    participant P38 as nowGMT3()
    participant P39 as writeSyncStatus()
    participant P40 as readSyncStatus()
    participant P41 as parsePopupTelemetry()
    participant P42 as isWithinMatchWindow()
    participant P43 as sanitizeStore()
    participant P44 as findRecoveredMatch()
    participant P45 as findLiveMatch()
    participant P46 as landingDensity()
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
    P1->>+ P10: calls
    P10-->>- P1: return
    P10->>+ P1: calls
    P1-->>- P10: return
    P10->>+ P11: calls
    P11-->>- P10: return
    P10->>+ P12: calls
    P12-->>- P10: return
    P10->>+ P13: calls
    P13-->>- P10: return
    P10->>+ P14: calls
    P14-->>- P10: return
    P10->>+ P15: calls
    P15-->>- P10: return
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
    P1->>+ P21: calls
    P21-->>- P1: return
    P1->>+ P11: calls
    P11-->>- P1: return
    P1->>+ P14: calls
    P14-->>- P1: return
    P1->>+ P22: calls
    P22-->>- P1: return
    P1->>+ P13: calls
    P13-->>- P1: return
    P1->>+ P23: calls
    P23-->>- P1: return
    P1->>+ P24: calls
    P24-->>- P1: return
    P1->>+ P25: calls
    P25-->>- P1: return
    P1->>+ P26: calls
    P26-->>- P1: return
    P0->>+ P27: calls
    P27-->>- P0: return
    P0->>+ P28: calls
    P28-->>- P0: return
    P0->>+ P29: calls
    P29-->>- P0: return
    P0->>+ P16: calls
    P16-->>- P0: return
    P0->>+ P18: calls
    P18-->>- P0: return
    P0->>+ P30: calls
    P30-->>- P0: return
    P0->>+ P31: calls
    P31-->>- P0: return
    P0->>+ P19: calls
    P19-->>- P0: return
    P0->>+ P32: calls
    P32-->>- P0: return
    P0->>+ P20: calls
    P20-->>- P0: return
    P0->>+ P33: calls
    P33-->>- P0: return
    P0->>+ P34: calls
    P34-->>- P0: return
    P0->>+ P35: calls
    P35-->>- P0: return
    P0->>+ P12: calls
    P12-->>- P0: return
    P0->>+ P36: calls
    P36-->>- P0: return
    P0->>+ P37: calls
    P37-->>- P0: return
    P0->>+ P11: calls
    P11-->>- P0: return
    P0->>+ P38: calls
    P38-->>- P0: return
    P0->>+ P39: calls
    P39-->>- P0: return
    P0->>+ P40: calls
    P40-->>- P0: return
    P0->>+ P13: calls
    P13-->>- P0: return
    P0->>+ P7: calls
    P7-->>- P0: return
    P0->>+ P41: calls
    P41-->>- P0: return
    P0->>+ P42: calls
    P42-->>- P0: return
    P0->>+ P25: calls
    P25-->>- P0: return
    P0->>+ P43: calls
    P43-->>- P0: return
    P0->>+ P44: calls
    P44-->>- P0: return
    P0->>+ P45: calls
    P45-->>- P0: return
    P0->>+ P46: calls
    P46-->>- P0: return
```

## Connections by Relation

### calls
- [[map]] `INFERRED`
- [[now]] `INFERRED`
- [[fetchInventory()]] `EXTRACTED`
- [[fetchApproxLaunches()]] `EXTRACTED`
- [[syncMonth()]] `EXTRACTED`
- [[DELETE()]] `EXTRACTED`
- [[fetchComplementaryLaunches()]] `EXTRACTED`
- [[fetchRadiosondyFeatures()]] `INFERRED`
- [[getCacheStatsByStation()]] `INFERRED`
- [[fetchSingleSounding()]] `EXTRACTED`
- [[fetchWyomingMonth()]] `EXTRACTED`
- [[listYearStores()]] `INFERRED`
- [[readYearStore()]] `INFERRED`
- [[fetchSondeHubArchiveFramesForDay()]] `INFERRED`
- [[analyzeTrajectory()]] `INFERRED`
- [[writeYearStore()]] `INFERRED`
- [[findStation()]] `INFERRED`
- [[fetchArchiveTrajectory()]] `INFERRED`
- [[nowGMT3()]] `INFERRED`
- [[writeSyncStatus()]] `INFERRED`

### contains
- [[route.ts]] `EXTRACTED`
- [[route.ts]] `EXTRACTED`
- [[route.ts]] `EXTRACTED`
- [[route.ts]] `EXTRACTED`

---

*Part of the graphify knowledge wiki. See [[index]] to navigate.*