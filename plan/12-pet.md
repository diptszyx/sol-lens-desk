# P4: Pet

**Depends on:** P3 (buy_confirmed, price_updated, position_closed events), P1 T1.5 (SQLite pet_state table)  
**Ref:** [PET.md](../PET.md)

---

## T4.1 — Pet Zustand Store

**Files:** `src/store/pet.ts` (tạo mới)

**What to do:**

```typescript
type PetEmotion =
  | 'idle'        // no positions, grazing
  | 'alert'       // new token detected
  | 'invested'    // position open, normal
  | 'pumping'     // any position > +20%
  | 'watching'    // any position within 10% of SL
  | 'shrug'       // position closed at loss (3s then → idle/invested)
  | 'celebration' // position closed in profit (5s then → idle/invested)

interface PetStore {
  emotion: PetEmotion
  xp: number
  level: number                    // 1, 2, or 3
  totalTokensSeen: number
  totalTrades: number

  setEmotion(e: PetEmotion): void
  addXp(amount: number): void
  incrementTokensSeen(): void
  incrementTrades(): void
}
```

**State machine rules:**
```
token_detected          → 'alert' (10s, then restore prev)
buy_confirmed           → 'invested'
price_updated, pnl>20%  → 'pumping'
price_updated, near_sl  → 'watching'
position_closed, loss   → 'shrug' (3s → idle or invested)
position_closed, profit → 'celebration' (5s → idle or invested)
no open positions       → 'idle'
```

**Multiple positions:** always show worst-case state.  
Priority: `watching > invested > pumping > idle`

---

## T4.2 — Pet XP Persistence

**Files:** `src/store/pet.ts`, `src-tauri/src/commands/` (new pet command)

**What to do:**

1. Thêm Tauri command:
   ```rust
   #[tauri::command]
   pub async fn get_pet_state(db: State<DbPool>) -> Result<PetStateDto, String>

   #[tauri::command]
   pub async fn update_pet_xp(db: State<DbPool>, xp_delta: i64, tokens_delta: i64, trades_delta: i64) -> Result<(), String>
   ```

2. Frontend: load XP từ SQLite khi app starts, sync sau mỗi XP event.

**XP gains:**
- `+1 XP` mỗi token_detected (sau khi pass filter)
- `+10 XP` mỗi trade confirmed (buy hoặc sell)

**Level thresholds:**
- Level 1: 0–499 XP
- Level 2: 500–1999 XP
- Level 3: 2000+ XP

---

## T4.3 — Event Wiring

**Files:** `src/store/pet.ts` hoặc `src/hooks/usePetTradeBridge.ts` (đã có)

**What to do:**

Check `usePetTradeBridge.ts` xem đã có event listeners chưa. Nếu chưa, thêm:

```typescript
// token_detected → alert + XP
listen('token_detected', (e) => {
  petStore.setEmotion('alert')
  petStore.incrementTokensSeen()
  petStore.addXp(1)
  // restore after 10s
  setTimeout(() => restorePrevEmotion(), 10_000)
})

// buy_confirmed → invested + XP
listen('buy_confirmed', () => {
  petStore.setEmotion('invested')
  petStore.incrementTrades()
  petStore.addXp(10)
})

// price_updated → pumping or watching
listen('price_updated', (e) => {
  const pnlPct = calcPnl(e.payload)
  const slThreshold = getSlThreshold(e.payload.mint)
  if (pnlPct > 20) petStore.setEmotion('pumping')
  else if (isNearSl(pnlPct, slThreshold)) petStore.setEmotion('watching')
  else petStore.setEmotion('invested')
})

// position_closed → shrug or celebration
listen('position_closed', (e) => {
  const emotion = e.payload.realized_pnl_pct > 0 ? 'celebration' : 'shrug'
  petStore.setEmotion(emotion)
  petStore.incrementTrades()
  petStore.addXp(10)
  // restore after duration
  const duration = emotion === 'celebration' ? 5000 : 3000
  setTimeout(() => restorePrevEmotion(), duration)
})
```

---

## T4.4 — PetCard Emotion Animations

**Files:** `src/components/pet/PetCard.tsx`

**What to do:**

PetCard hiện tại chỉ show 1 static state. Cần map `PetEmotion` → animation/visual:

| Emotion | Visual |
|---|---|
| `idle` | Capybara grazing slowly, occasional yawn |
| `alert` | Ears up, head turns toward token info |
| `invested` | Slightly tense, watching |
| `pumping` | Bouncing/dancing |
| `watching` | Eyes wide, very still |
| `shrug` | Shoulder shrug → turns back → resume grazing |
| `celebration` | Big reaction, spin/jump |

**Implementation note:** Hiện tại dùng gì cho animation? Check `PetCard.tsx` và `PetApp.tsx`. Nếu dùng CSS, thêm class per emotion. Nếu planning Lottie/Rive → defer đến phase sau khi có asset.

MVP: CSS animation classes per emotion (không cần Lottie asset ngay).

---

## T4.5 — MiniPet Widget (Always Visible)

**Files:** `src/components/pet/MiniPet.tsx` (tạo mới)

**What to do:**

Small widget, luôn visible ở góc dashboard:

```
┌──────────────────────────────┐
│  [feed]  [portfolio]    [🐾] │  ← mini pet icon in header/corner
└──────────────────────────────┘
```

- Size: 48x48px animated icon
- Reflects current `PetEmotion` state
- Click → expand to show XP bar + level
- No separate "pet screen" — pet lives trong main dashboard

---

## T4.6 — Level Up Notification

**Files:** `src/store/pet.ts`, `src/components/pet/MiniPet.tsx`

**What to do:**

Khi XP cross level threshold:
1. Set `level` mới
2. Emit local event hoặc toast: "🐾 Capy leveled up to Level 2!"
3. Persist level vào SQLite
4. MiniPet shows brief level-up animation

---

## Checklist P4

- [ ] T4.1: pet store có PetEmotion enum + state machine logic
- [ ] T4.2: XP/level load từ SQLite on startup, persist on change
- [ ] T4.3: All 4 events wired → emotion transitions đúng theo state machine
- [ ] T4.4: PetCard visually different per emotion (CSS classes minimum)
- [ ] T4.5: MiniPet widget visible in dashboard, reflects emotion
- [ ] T4.6: Level up notification khi cross threshold
- [ ] Test: Buy → emotion = 'invested'
- [ ] Test: Position +25% → emotion = 'pumping'
- [ ] Test: SL hit → emotion = 'shrug' → restore after 3s
- [ ] Test: Win sell → emotion = 'celebration' → restore after 5s
