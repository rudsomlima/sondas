# readCache()

> God node · 9 connections · [C:\Users\rudso\OneDrive\Documentos\Site_sonda\sondas\app\lib\cache.ts](file:///C:/Users/rudso/OneDrive/Documentos/Site_sonda/sondas/app/lib/cache.ts#L26)

## Call Trace Diagram

```mermaid
sequenceDiagram
    participant P0 as readCache()
    participant P1 as getCacheStatsByStation()
    participant P2 as GET()
    participant P3 as map
    participant P4 as now
    participant P5 as fetchInventory()
    participant P6 as fetchApproxLaunches()
    participant P7 as syncMonth()
    participant P8 as DELETE()
    participant P9 as fetchComplementaryLaunches()
    participant P10 as fetchRadiosondyFeatures()
    participant P11 as fetchSingleSounding()
    participant P12 as fetchWyomingMonth()
    participant P13 as listYearStores()
    participant P14 as readYearStore()
    participant P15 as fetchSondeHubArchiveFramesForDay()
    participant P16 as analyzeTrajectory()
    participant P17 as writeYearStore()
    participant P18 as findStation()
    participant P19 as fetchArchiveTrajectory()
    participant P20 as nowGMT3()
    participant P21 as writeSyncStatus()
    participant P22 as readSyncStatus()
    participant P23 as fetchLiveTrajectory()
    participant P24 as launchUtcInstant()
    participant P25 as parsePopupTelemetry()
    participant P26 as isWithinMatchWindow()
    participant P27 as pointsFromFrames()
    participant P28 as sanitizeStore()
    participant P29 as findRecoveredMatch()
    participant P30 as findLiveMatch()
    participant P31 as landingDensity()
    participant P32 as has
    participant P33 as stationOf()
    participant P34 as writeCache()
    participant P35 as getCacheStats()
    participant P36 as getCacheByYear()
    participant P37 as clearMonth()
    participant P38 as clearYear()
    participant P39 as clearStation()
    participant P40 as exportCache()
    P0->>+ P1: calls
    P1-->>- P0: return
    P1->>+ P2: calls
    P2-->>- P1: return
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
    P2->>+ P1: calls
    P1-->>- P2: return
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
    P2->>+ P19: calls
    P19-->>- P2: return
    P2->>+ P20: calls
    P20-->>- P2: return
    P2->>+ P21: calls
    P21-->>- P2: return
    P2->>+ P22: calls
    P22-->>- P2: return
    P2->>+ P23: calls
    P23-->>- P2: return
    P2->>+ P24: calls
    P24-->>- P2: return
    P2->>+ P25: calls
    P25-->>- P2: return
    P2->>+ P26: calls
    P26-->>- P2: return
    P2->>+ P27: calls
    P27-->>- P2: return
    P2->>+ P28: calls
    P28-->>- P2: return
    P2->>+ P29: calls
    P29-->>- P2: return
    P2->>+ P30: calls
    P30-->>- P2: return
    P2->>+ P31: calls
    P31-->>- P2: return
    P1->>+ P3: calls
    P3-->>- P1: return
    P1->>+ P32: calls
    P32-->>- P1: return
    P1->>+ P0: calls
    P0-->>- P1: return
    P1->>+ P33: calls
    P33-->>- P1: return
    P0->>+ P34: calls
    P34-->>- P0: return
    P0->>+ P35: calls
    P35-->>- P0: return
    P0->>+ P36: calls
    P36-->>- P0: return
    P0->>+ P37: calls
    P37-->>- P0: return
    P0->>+ P38: calls
    P38-->>- P0: return
    P0->>+ P39: calls
    P39-->>- P0: return
    P0->>+ P40: calls
    P40-->>- P0: return
```

## Connections by Relation

### calls
- [[getCacheStatsByStation()]] `EXTRACTED`
- [[writeCache()]] `EXTRACTED`
- [[getCacheStats()]] `EXTRACTED`
- [[getCacheByYear()]] `EXTRACTED`
- [[clearMonth()]] `EXTRACTED`
- [[clearYear()]] `EXTRACTED`
- [[clearStation()]] `EXTRACTED`
- [[exportCache()]] `EXTRACTED`

### contains
- [[cache.ts]] `EXTRACTED`

---

*Part of the graphify knowledge wiki. See [[index]] to navigate.*