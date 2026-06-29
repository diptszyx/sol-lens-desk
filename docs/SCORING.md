# Token Scoring

Score range: **0–100**. Higher = safer signal.

## Components

| Component | Max | Signal |
|-----------|-----|--------|
| dev_hold_safety | 40 | Dev wallet risk |
| bonding_curve_signal | 30 | Momentum |
| dev_buy_signal | 20 | Skin in game |
| socials_signal | 10 | Project legitimacy |

---

### dev_hold_safety (max 40)

How much of total supply the dev still holds at launch.

| Dev hold % | Points |
|-----------|--------|
| < 5% | 40 |
| 5–10% | 20 |
| ≥ 10% | 0 |

**Source:** `initialBuy` (token amount) / 1,000,000,000 × 100

---

### bonding_curve_signal (max 30)

How far the bonding curve has filled (0% = just created, 100% = graduated to Raydium).

| Curve filled | Points | Meaning |
|-------------|--------|---------|
| < 30% | 0 | Barely started, unproven |
| 30–50% | 30 | Sweet spot — momentum, still early |
| 50–70% | 20 | Late but room left |
| ≥ 70% | 5 | Near graduation, dump risk |

**Formula:**
```
curve_pct = (INIT_VTOKENS - vTokensInBondingCurve) / (INIT_VTOKENS - GRAD_RESERVE) × 100

INIT_VTOKENS = 1,073,000,000
GRAD_RESERVE = 206,900,000
```

---

### dev_buy_signal (max 20)

SOL the creator spent buying their own token at launch.

| Dev buy (SOL) | Points |
|--------------|--------|
| ≥ 1.0 | 20 |
| ≥ 0.5 | 10 |
| < 0.5 | 0 |

**Source:** `solAmount` from pumpportal create event

---

### socials_signal (max 10)

Whether the token metadata URI contains social links (twitter, telegram, website).

| Has socials | Points |
|------------|--------|
| Any link present | 10 |
| None | 0 |

Fetched at enrich time via HTTP GET on the IPFS/Arweave URI (5s timeout).
Easily faked — weighted low intentionally.

---

## Liquidity (`liquidity_sol`)

**Real SOL deposited** by traders:

```
liquidity_sol = max(vSolInBondingCurve − 30.0, 0)
```

The `30.0` constant is pump.fun's initial virtual SOL reserve (protocol constant, NOT real deposited SOL). All new tokens start with ~30 virtual SOL for AMM price calculation.

---

## Score Presets

| Preset | Threshold | Typical requirement |
|--------|-----------|---------------------|
| Degen | 30 | Any signal at all |
| Balanced | 60 | dev_hold < 5% (40) + curve 30–50% needs partial, or dev_buy ≥ 1 SOL (20) |
| Safe | 80 | dev_hold < 5% (40) + curve 30–50% (30) + any extra |

**Default filter:** Balanced (60)

---

## What score does NOT cover

- Holder distribution (no on-chain fetch at detection time)
- Trade velocity / unique buyer count
- Dev wallet rug history
- Price momentum

These require extra RPC calls and are candidates for future `re_enrich_loop` passes.
