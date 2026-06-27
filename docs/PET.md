# Pet Mechanics — Design Document

**Last updated:** 2026-06-27  
**Status:** Discussed & agreed, pending implementation  
**See also:** [PORTFOLIO_TRADE.md](PORTFOLIO_TRADE.md) — PnL data that feeds pet state

---

## Design Philosophy

Target user is a "degen" — someone who loses 99.6% of the time (pump.fun data) and embraces that as identity. Pet design must reflect this:

- **No guilt mechanics.** Degens pre-frame losses as "part of the game." A sad/crying pet after a loss = condescending, not motivating. Users will ignore it.
- **No outcome-based evolution.** Evolution tied to wins = almost never progresses. Kills motivation.
- **Solidarity companion, not performance judge.** Pet experiences the journey with the user — highs and lows — without grading them.
- **Capybara personality = perfect fit.** Chill, unbothered, no judgment. After a rug: pet keeps eating grass. This *is* the degen identity.

---

## Emotion States

Pet reacts to **events** (what happens), not cumulative P&L. Tone follows win/loss outcome.

| State | Trigger | Animation description |
|---|---|---|
| **Idle** | No open positions, app open | Grazing slowly, occasional glance around, yawns |
| **Alert** | New token detected | Ears up, sniffing, head turns toward token card |
| **Invested** | User executes a buy | Nervous-excited, bouncing slightly — "oh shit here we go" |
| **Pumping** | Open position > +20% | Dancing, wiggling, happy energy |
| **Watching** | Position within 10% of stop loss | Still, eyes wide, staring intently at screen |
| **Shrug** | Stop loss triggered (loss) | Small shrug, turns back, resumes grazing — "we move" |
| **Celebration** | Manual sell in profit | Big reaction — rare event, make it memorable |

### Key design notes

- **Shrug state** is intentional, not lazy design. Loss = expected outcome for degens. Unbothered reaction embodies the identity. No crying animation.
- **Celebration** must feel proportional to rarity. Wins are uncommon — when they happen, pet goes all out.
- **Alert** should feel like shared excitement, not a warning. The capybara is curious, not alarmed.
- State transitions are event-driven, not polled. Pet doesn't slowly drift between states — it reacts to discrete events.

---

## State Transition Logic

```
app opened, no positions
  → Idle

token_detected event
  → Alert (10s, or until dismissed/bought)
  → returns to Idle if no buy

buy confirmed
  → Invested

price update: position_pnl > +20%
  → Pumping

price update: position within 10% of SL threshold
  → Watching (overrides Pumping if was pumping)

stop_loss triggered → sell confirmed
  → Shrug (3s)
  → Idle

manual sell confirmed, pnl > 0
  → Celebration (5s)
  → Idle

manual sell confirmed, pnl <= 0
  → Shrug (3s)
  → Idle
```

Multiple open positions: pet reflects the **worst-case** position state. If one position is Watching and another is Pumping → show Watching. Safety first.

---

## Evolution

### Why evolution

Research (Tamagotchi, Finch): emotion states handle daily stakes, evolution handles long-term investment. Without it, the pet plateaus — no reason to keep caring over months.

### Axis: activity, not outcomes

Tied to what the user **does**, not whether they win. Degens are active — this will progress even for consistent losers.

| XP source | Amount |
|---|---|
| Token spotted (app running, token passes filter) | +1 XP |
| Any trade executed (buy or sell) | +10 XP |

### Stages (MVP — 3 levels)

| Level | Name | XP required | Visual change |
|---|---|---|---|
| 1 | Capy Pup | 0 | Small, basic capybara |
| 2 | Adult Capy | 500 XP | Full size, slightly rounder |
| 3 | Distinguished Capy | 2000 XP | Accessories unlock (hat, sunglasses, etc.) |

- **Cosmetic only.** Evolution does not affect pet behavior or app functionality.
- **Accessories** at level 3 are unlockable cosmetics, not automatic. User picks from earned pool.
- XP persists in SQLite alongside trades/positions.

---

## Where Pet Lives

### PetCard (already exists)
- Appears as overlay when `token_detected` fires
- Shows Alert state
- Auto-dismisses after 10s
- Replaced by next token if one arrives within 10s window

### Mini pet (new — always visible)
- Small corner widget in main dashboard
- Idle/ambient animation always running
- Reflects current state (Idle, Invested, Pumping, Watching)
- Click → expands to show current position summary

### Portfolio panel integration
- Mini pet in corner of PortfolioPanel
- Reflects worst-case position state across all open positions

---

## What Pet Does NOT Do

- **No guilt when app is closed.** Desktop app — if app is closed, pet doesn't exist. No push notifications about pet being sad. Unlike Duolingo, this is a tool not a daily-habit app.
- **No warnings.** Pet doesn't say "are you sure?" before a buy. Degens don't want second-guessing.
- **No lecturing.** Pet reacts, never advises.
- **No death mechanic.** Pet cannot die from neglect or losses. Too punishing for an already-stressful context.
- **No leaderboards or social comparison** via pet. Finch/Duolingo social features don't fit a solo trading tool.

---

## Backend / Frontend Changes Needed

### New data pet needs from backend

| Data | Source | Existing? |
|---|---|---|
| `token_detected` event | pumpportal WS pipeline | ✅ exists |
| `price_updated` event per position | price_tracker.rs | ❌ new (see PORTFOLIO_TRADE.md) |
| `position_closed` event (reason: manual/sl) | sell.rs | ❌ new |
| Buy confirmed event | swap.rs | ⚠️ needs emit |
| Position PnL % (for state thresholds) | calculated from price_updated | ❌ new |

### Pet XP persistence

Add to SQLite schema:
```sql
CREATE TABLE pet_state (
    id          INTEGER PRIMARY KEY CHECK(id = 1),  -- single row
    xp          INTEGER NOT NULL DEFAULT 0,
    level       INTEGER NOT NULL DEFAULT 1,
    total_tokens_seen  INTEGER NOT NULL DEFAULT 0,
    total_trades       INTEGER NOT NULL DEFAULT 0
);
```

### Frontend

```
src/
├── components/
│   ├── pet/
│   │   ├── PetCard.tsx         ← already exists, needs Alert state animation
│   │   ├── MiniPet.tsx         ← new — always-visible corner widget
│   │   └── pet.css
├── store/
│   └── pet.ts                  ← new — current pet state (Idle/Alert/etc), XP, level
```

Pet state machine lives in frontend Zustand store, driven by events from backend.

---

## Open Questions (Phase 2)

| # | Question |
|---|---|
| 1 | Lottie vs Rive for animations? Rive has state machines built-in — better fit for event-driven states |
| 2 | Accessories inventory UI — where does user equip/change them? |
| 3 | Sound effects for Celebration state? (user can toggle) |
| 4 | Multiple positions: worst-case rule might feel wrong if one big winner exists — revisit |
