# has

> God node · 10 connections · [C:\Users\rudso\OneDrive\Documentos\Site_sonda\sondas\app\historico\components\MonthAccordion.tsx](file:///C:/Users/rudso/OneDrive/Documentos/Site_sonda/sondas/app/historico/components/MonthAccordion.tsx#L232)

## Call Trace Diagram

```mermaid
sequenceDiagram
    participant P0 as has
    participant P1 as redraw()
    participant P2 as map
    participant P3 as GET()
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
    participant P19 as buildBalloonIcon()
    participant P20 as buildHighlightLiveBalloonIcon()
    participant P21 as buildHighlightBalloonIcon()
    participant P22 as launchUtcInstant()
    participant P23 as statusColor()
    participant P24 as gmt3IconLabel()
    participant P25 as fetchTodayFlights()
    participant P26 as fetchApproxLaunches()
    participant P27 as fetchRadiosondyLaunches()
    participant P28 as fetchComplementaryLaunches()
    participant P29 as fetchSondeHubArchiveLaunches()
    participant P30 as parseInventory()
    P0->>+ P1: calls
    P1-->>- P0: return
    P1->>+ P2: calls
    P2-->>- P1: return
    P2->>+ P3: calls
    P3-->>- P2: return
    P2->>+ P1: calls
    P1-->>- P2: return
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
    P1->>+ P21: calls
    P21-->>- P1: return
    P1->>+ P22: calls
    P22-->>- P1: return
    P1->>+ P23: calls
    P23-->>- P1: return
    P1->>+ P24: calls
    P24-->>- P1: return
    P0->>+ P25: calls
    P25-->>- P0: return
    P0->>+ P26: calls
    P26-->>- P0: return
    P0->>+ P27: calls
    P27-->>- P0: return
    P0->>+ P6: calls
    P6-->>- P0: return
    P0->>+ P28: calls
    P28-->>- P0: return
    P0->>+ P8: calls
    P8-->>- P0: return
    P0->>+ P29: calls
    P29-->>- P0: return
    P0->>+ P30: calls
    P30-->>- P0: return
```

## Connections by Relation

### calls
- [[redraw()]] `INFERRED`
- [[fetchTodayFlights()]] `INFERRED`
- [[fetchApproxLaunches()]] `INFERRED`
- [[fetchRadiosondyLaunches()]] `INFERRED`
- [[fetchSondeHubApproxLaunches()]] `INFERRED`
- [[fetchComplementaryLaunches()]] `INFERRED`
- [[getCacheStatsByStation()]] `INFERRED`
- [[fetchSondeHubArchiveLaunches()]] `INFERRED`
- [[parseInventory()]] `INFERRED`

### contains
- [[MonthAccordion.tsx]] `EXTRACTED`

---

*Part of the graphify knowledge wiki. See [[index]] to navigate.*