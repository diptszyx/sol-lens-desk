# Implementation Plan — Master

**Last updated:** 2026-06-27  
**Status:** Ready to implement

---

## Phase Overview

```
P1: Foundation  ←─── blocks everything
   ↓
P2: Filter      ←─── depends on score (P1)
   ↓
P3: Portfolio   ←─── depends on SQLite (P1), price events
   ↓
P4: Pet         ←─── depends on position events (P3)
```

| Phase | What | Detail |
|---|---|---|
| **P1** | Foundation | Live SOL price · Mint/freeze RPC check · Score · SQLite setup |
| **P2** | Filter | Score slider · Hard gates · Simplified FilterConfig |
| **P3** | Portfolio + Trade | Sell · Stop loss · subscribeTokenTrade · SQLite persistence |
| **P4** | Pet | Emotion states · Evolution · MiniPet widget |

---

## Critical Path

```
P1.1 SOL price fix  →  P1.3 compute_score  →  P2 Filter
P1.5 SQLite setup   →  P3.1 db schema      →  P3 Portfolio
P3.6 events emit    →  P4.3 pet state wire →  P4 Pet
```

## Phase Details

- [Foundation](../plan/09-foundation.md)
- [Filter](../plan/10-filter.md)
- [Portfolio + Trade](../plan/11-portfolio.md)
- [Pet](../plan/12-pet.md)

## Key Docs

- [SIGNAL_RESEARCH.md](SIGNAL_RESEARCH.md) — score formula + weights
- [FILTER.md](FILTER.md) — filter UX decisions
- [PORTFOLIO_TRADE.md](PORTFOLIO_TRADE.md) — sell/SL/price architecture
- [PET.md](PET.md) — emotion states + evolution
- [THIRD_PARTY_SERVICES.md](THIRD_PARTY_SERVICES.md) — API reference
