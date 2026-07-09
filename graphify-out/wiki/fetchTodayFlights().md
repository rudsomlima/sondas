# fetchTodayFlights()

> God node · 8 connections · [C:\Users\rudso\OneDrive\Documentos\Site_sonda\sondas\app\lib\radiosondy.ts](file:///C:/Users/rudso/OneDrive/Documentos/Site_sonda/sondas/app/lib/radiosondy.ts#L131)

## Call Trace Diagram

```mermaid
sequenceDiagram
    participant P0 as fetchTodayFlights()
    participant P1 as has
    participant P2 as redraw()
    participant P3 as map
    participant P4 as buildBalloonIcon()
    participant P5 as buildHighlightLiveBalloonIcon()
    participant P6 as buildHighlightBalloonIcon()
    participant P7 as launchUtcInstant()
    participant P8 as statusColor()
    participant P9 as gmt3IconLabel()
    participant P10 as fetchApproxLaunches()
    participant P11 as GET()
    participant P12 as syncMonth()
    participant P13 as fetchRadiosondyLaunches()
    participant P14 as fetchSondeHubApproxLaunches()
    participant P15 as fetchSondeHubArchiveLaunches()
    participant P16 as fetchComplementaryLaunches()
    participant P17 as getCacheStatsByStation()
    participant P18 as parseInventory()
    participant P19 as fetchRadiosondyFeatures()
    participant P20 as toReportStr()
    participant P21 as gmt3DateStr()
    participant P22 as parsePopupTelemetry()
    participant P23 as fetchLiveFlights()
    participant P24 as matchesStartplace()
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
    P1->>+ P0: calls
    P0-->>- P1: return
    P1->>+ P10: calls
    P10-->>- P1: return
    P10->>+ P11: calls
    P11-->>- P10: return
    P10->>+ P1: calls
    P1-->>- P10: return
    P10->>+ P12: calls
    P12-->>- P10: return
    P10->>+ P13: calls
    P13-->>- P10: return
    P10->>+ P14: calls
    P14-->>- P10: return
    P10->>+ P15: calls
    P15-->>- P10: return
    P1->>+ P13: calls
    P13-->>- P1: return
    P1->>+ P14: calls
    P14-->>- P1: return
    P1->>+ P16: calls
    P16-->>- P1: return
    P1->>+ P17: calls
    P17-->>- P1: return
    P1->>+ P15: calls
    P15-->>- P1: return
    P1->>+ P18: calls
    P18-->>- P1: return
    P0->>+ P19: calls
    P19-->>- P0: return
    P0->>+ P20: calls
    P20-->>- P0: return
    P0->>+ P21: calls
    P21-->>- P0: return
    P0->>+ P22: calls
    P22-->>- P0: return
    P0->>+ P23: calls
    P23-->>- P0: return
    P0->>+ P24: calls
    P24-->>- P0: return
```

## Connections by Relation

### calls
- [[has]] `INFERRED`
- [[fetchRadiosondyFeatures()]] `EXTRACTED`
- [[toReportStr()]] `EXTRACTED`
- [[gmt3DateStr()]] `EXTRACTED`
- [[parsePopupTelemetry()]] `EXTRACTED`
- [[fetchLiveFlights()]] `EXTRACTED`
- [[matchesStartplace()]] `EXTRACTED`

### contains
- [[radiosondy.ts]] `EXTRACTED`

---

*Part of the graphify knowledge wiki. See [[index]] to navigate.*