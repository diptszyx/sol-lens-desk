# Signal Research — pump.fun Token Quality

**Last updated:** 2026-06-27  
**Sources:** Solidus Labs, Flintr, Flashift, ArXiv SolRugDetector, pump-fun-rug-checker-lite

---

## Reality Check: Base Rates

```
Total tokens launched on pump.fun:    >13,000,000
Tokens that are rug or pump-and-dump: 98.6%  (Solidus Labs)
Tokens sustaining >$1,000 liquidity:  ~0.7%
Tokens that graduate to Raydium:      ~1%
```

Most alerts without filtering = noise. Filter quality is the product.

---

## Token Lifecycle (Timing)

```
Seconds 0–30    Early ape window. Price cheapest. Highest risk.
Seconds 30–120  Bonding curve fills. Whale buy/dump phase.
Minutes 2–10    Survival test. Either gains momentum or dies.
Minutes 10–30   Graduation (~85 SOL raised → Raydium migration)
Minutes 30+     Token is either established or dead.
```

**Implication:** Price polling interval must be ≤5s. Alert-to-decision window is 30–120 seconds.

---

## Signal Classification

### Tier 1: Hard Gates (Binary — fail any = reject, no score computed)

These are non-negotiable. A token failing any gate is almost certainly a rug.

| Signal | Condition to BLOCK | How to detect |
|---|---|---|
| Mint authority active | `mintAuthority !== null` | `getMint(mint)` RPC call |
| Freeze authority active | `freezeAuthority !== null` | `getMint(mint)` RPC call (same call) |
| Bundled launch | Dev used 15–20 wallets in same block to buy 25–40% supply | Compare dev_token_amount vs total supply ratio + block tx analysis |

**Important caveat:** Attackers can revoke authorities at launch to pass hard gates, then execute pump-and-dump via coordinated wallet behavior. Hard gates are necessary but not sufficient. (Source: ArXiv SolRugDetector)

---

### Tier 2: Score 0–100 (Tokens that pass hard gates)

Split into Safety + Signal. Combined score determines alert quality.

#### Safety Score (max 50 points)

| Signal | Points | Threshold | Rationale |
|---|---|---|---|
| Dev hold % | 30 / 15 / 0 | <5% → 30pts, 5–10% → 15pts, >10% → 0pts | "Creator >5% = you are the exit liquidity" (Flashift). Community consensus on 5% threshold. |
| LP locked | 20 | Post-graduation Raydium only | Pre-graduation: no LP exists yet (still on bonding curve). Only relevant after ~85 SOL raised. |

**Dev hold % is the single most cited metric across all sources.**

#### Signal/Momentum Score (max 50 points)

| Signal | Points | Threshold | Rationale |
|---|---|---|---|
| Bonding curve progress | 25 / 15 / 5 / 0 | 30–50% → 25pts, 50–70% → 15pts, >70% → 5pts, <30% → 0pts | "30% filters 90–95% of dead-on-arrival tokens" (Flashift). Sweet spot is 30–50%: proven momentum, still early. >70% = near graduation, less price upside. |
| Dev buy SOL | 15 / 8 / 0 | >1 SOL → 15pts, 0.5–1 SOL → 8pts, <0.5 SOL → 0pts | Dev with skin in game won't rug immediately. <0.5 SOL = dev doesn't believe in own token. |
| Has socials | 10 | Boolean | Weak signal (easily faked), but some community effort. Bonus only, never blocking. |

---

## Score Thresholds (Recommended Defaults)

| Mode | Threshold | Expected alerts/day | Profile |
|---|---|---|---|
| Degen | ≥ 30 | High (dozens) | Accept most tokens, high loss rate, hunting 100x |
| Balanced | ≥ 55 | Medium (5–20) | Filter obvious rugs, still early entries |
| Safe | ≥ 75 | Low (1–5) | Only tokens with strong safety + momentum, mostly post-bonding |

User sets one number. App handles the rest.

---

## Signals NOT Worth Weighting Heavily

| Signal | Problem |
|---|---|
| Social links (Twitter/Telegram) | Created in 5 minutes, meaningless |
| Token name / branding | Entirely subjective and fakeable |
| Volume spikes | Trivial to wash trade |
| Holder count | Airdrop fake holders, bundle wallets disguise concentration |
| "Viral theme" | Not deterministic, can't score |

**Rule:** Only trust on-chain data that is costly to fake.

---

## Bundling — The Hidden Threat

Bundled launches are a major rug pattern not covered by basic filters:

- Dev creates 15–20 fresh wallets, all funded from same master wallet
- All wallets buy in the **same block** as launch
- Accumulate 25–40% of supply before first candle appears
- Appears as distributed holders on surface
- Detection: check if multiple wallets bought in exact same slot (Jito bundle)

2025 data: 4,600 sniper wallets + 10,400 deployers extracted >15,000 SOL/month via this method.

---

## What Existing Tools Check (Reference)

### pump-fun-rug-checker-lite
Binary gates only (PASS/BLOCK system):
- `block_on_active_mint_authority: true`
- `block_on_active_freeze_authority: true`
- `block_on_unlocked_liquidity: true`
- `max_dev_allocation_pct: 20` (blocks if single wallet >20%)

### Bitquery Token Sniffer
Provides score based on:
- Holder distribution patterns
- Transfer patterns (received without buying = suspicious)
- Compares transfers vs purchases

### Sniper bots (general)
Common filter stack:
- Metadata immutable check
- Mint renounced
- Non-freezable
- LP burned
- Blacklist function absent
- Bundle flag (>30% sniper supply = risky)

---

## Data Requirements for Implementation

| Signal | Status in current app | Action needed |
|---|---|---|
| `mint_authority_revoked` | ❌ Missing | Add to enricher: `getMint(mint)` → check `mintAuthority === null` |
| `freeze_authority_revoked` | ❌ Missing | Same RPC call as above |
| `dev_hold_pct` | ✅ Available | Already in `DetectedToken` |
| `bonding_curve_pct` | ✅ Available | Already in `DetectedToken` |
| `dev_buy_sol` | ✅ Available | Already in `DetectedToken` |
| `has_socials` | ✅ Available | Already in `DetectedToken` |
| Bundle detection | ❌ Missing | Requires block-level tx analysis — defer to later |
| LP locked | ❌ Missing | Only relevant post-graduation, defer |

**Minimum viable addition:** 1 RPC call (`getMint`) unlocks 2 hard gates + highest-weight safety signal.

---

## Score Implementation (Rust pseudocode)

```rust
pub fn compute_score(token: &TokenInfo) -> Option<u8> {
    // Hard gates: return None to signal "reject, don't alert"
    if token.mint_authority_active    { return None }
    if token.freeze_authority_active  { return None }

    let mut score: i32 = 0;

    // Safety (max 50)
    score += match token.dev_hold_pct {
        x if x < 5.0  => 30,
        x if x < 10.0 => 15,
        _              => 0,
    };
    if token.lp_locked { score += 20 }

    // Signal (max 50)
    score += match token.bonding_curve_pct {
        x if x >= 30.0 && x < 50.0 => 25,
        x if x >= 50.0 && x < 70.0 => 15,
        x if x >= 70.0              =>  5,
        _                           =>  0,
    };
    score += match token.dev_buy_sol {
        x if x >= 1.0 => 15,
        x if x >= 0.5 =>  8,
        _             =>  0,
    };
    if token.has_socials { score += 10 }

    Some(score.clamp(0, 100) as u8)
}
```

`None` = blocked by hard gate, don't alert.  
`Some(score)` = alert if score >= user threshold.

---

## Open Questions

1. **Bundle detection cost:** Block-level tx analysis requires extra RPC calls per token. At 50,000 tokens/day, this may hit rate limits. Defer or sample?
2. **LP lock for graduated tokens:** Need separate data source (Streamflow API or check Raydium pool). Different code path.
3. **Weight calibration:** No ground truth yet. Need feedback loop: log alerts + score, check price after 5/30 minutes, backtest weights.
4. **Score transparency:** Show users which components contributed to score (Safety: 30/50, Signal: 25/50) so they can understand and trust it.
