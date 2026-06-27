# Filter System — Design Document

**Last updated:** 2026-06-27  
**Status:** Discussed & agreed, pending implementation  
**See also:** [SIGNAL_RESEARCH.md](SIGNAL_RESEARCH.md) — score formula, weights, data sources

---

## Current State → Planned State

### Dropped Fields (replaced by score or irrelevant)

| Field | Reason |
|---|---|
| `maxDevHoldPct` | Absorbed into Safety score component |
| `minDevBuySol` | Absorbed into Signal score component |
| `minBondingCurvePct` | Absorbed into Signal score component |
| `requireSocials` | Weak signal, easily faked, small weight in score |
| `maxMcapUsd` | Bonding curve implicitly caps mcap for new tokens |
| `sources[]` | Only pump.fun active — useless until new source added |

### Kept Fields

| Field | Role |
|---|---|
| `minScoreThreshold` | **New** — replaces all signal fields above |
| `maxAgeSec` | Hard utility filter — stale tokens not worth showing |
| `minLiquiditySol` | Hard utility filter — floor for tradeable liquidity |
| `hideUnnamed` | UI preference — unnamed tokens = noise |
| `search` | Text search by symbol/name — utility |

---

## Hard Gates (Always On, No Config)

Applied in backend **before** score computation. Token failing either gate is **not emitted** — never appears in feed.

| Gate | Check | Data source |
|---|---|---|
| Mint authority active | `getMint(mint).mintAuthority !== null` | RPC call in enricher |
| Freeze authority active | `getMint(mint).freezeAuthority !== null` | Same RPC call |

User never sees these tokens. No warning, no dim — simply filtered at source.

---

## Score Threshold

Single slider replacing all signal-based filter fields.

**Defaults:**
```
Degen    → threshold 30   (many alerts, high risk, hunting 100x)
Balanced → threshold 55   (default — filter obvious rugs)
Safe     → threshold 75   (rare alerts, quality only)
```

Score formula → see [SIGNAL_RESEARCH.md](SIGNAL_RESEARCH.md).  
Score computed in **Rust enricher**, stored in `TokenInfo.score: u8`.  
Frontend filters: `token.score >= threshold`.

---

## New FilterConfig Shape

```typescript
interface FilterConfig {
  minScoreThreshold: number   // 0–100, default 55
  maxAgeSec: number | null    // default 300 (5 min)
  minLiquiditySol: number | null  // default 5
  hideUnnamed: boolean        // default true
  search: string              // default ""
}
```

---

## Filter UI

```
┌──────────────────────────────────────────┐
│  [Degen · 30]  [● Balanced · 55]  [Safe · 75]  │  ← preset chips
│                                          │
│  Score   ●──────────────  55            │  ← single slider
│                                          │
│  Max age      [ 5 min  ]                │
│  Min liq      [ 5 SOL  ]                │
│  Hide unnamed   [✓]                     │
└──────────────────────────────────────────┘
```

- Preset chips: clicking sets slider to preset value
- Slider overrides preset (chips deselect)
- Advanced fields collapsible (default open)
- Search bar stays in token feed header (not in filter panel)

---

## Score Display in UI

### TokenRow (feed list)
```
$PEPE  [72]  $0.0001  45% curve  3.2 SOL liq  12s ago
```
- Badge color: ≥ 70 green · 40–69 yellow · < 40 red
- Badge always visible — trader sees quality at a glance

### PetCard (overlay alert)
```
🚨 $PEPE          Score: 72/100
Dev: 3% · Curve: 45% · Buy: 1.2◎
[0.1◎]  [0.5◎]  [1◎]     [BUY]
```
- Score large, prominent — first thing trader reads

### TokenDetail (full detail panel)
Score badge + breakdown:
```
Score: 72 / 100
  Safety  ──────────  30 / 50   (dev hold 3%)
  Signal  ─────────   42 / 50   (curve 45%, dev buy 1.2◎, has socials)
```

---

## Backend Changes Needed

### enricher.rs
1. Add `getMint()` RPC call → check `mintAuthority` + `freezeAuthority`
2. Add `mint_authority_revoked: bool` + `freeze_authority_revoked: bool` to `TokenInfo`
3. Add `score: u8` field computed via `compute_score()`
4. Return `None` from `enrich()` if either authority active (hard gate)

### TokenInfo new fields
```rust
pub struct TokenInfo {
    // ... existing fields ...
    pub mint_authority_revoked: bool,
    pub freeze_authority_revoked: bool,
    pub score: u8,
}
```

### compute_score (Rust)
See pseudocode in [SIGNAL_RESEARCH.md](SIGNAL_RESEARCH.md#score-implementation-rust-pseudocode).

---

## Frontend Changes Needed

### store/filter.ts
- Replace 6 signal fields with `minScoreThreshold: number`
- Keep `maxAgeSec`, `minLiquiditySol`, `hideUnnamed`, `search`

### lib/filter.ts — matchesFilter()
```typescript
function matchesFilter(token: DetectedToken, config: FilterConfig): boolean {
  if (config.hideUnnamed && !token.symbol) return false
  if (config.maxAgeSec != null && token.age_seconds > config.maxAgeSec) return false
  if (config.minLiquiditySol != null && token.liquidity_sol < config.minLiquiditySol) return false
  if (token.score < config.minScoreThreshold) return false
  if (config.search && !matchesSearch(token, config.search)) return false
  return true
}
```

### components/filter/FilterPanel.tsx
Rebuild UI: preset chips + score slider + 3 utility fields.

### types/index.ts
Add `score: number` to `DetectedToken` interface.
