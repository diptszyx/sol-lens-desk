# P22: Pet Sync Revised — Main as Full Controller

**Status:** Planned  
**Supersedes:** [21-pet-emotion-sync.md](./21-pet-emotion-sync.md) (emotion-only sync — incomplete)  
**Depends on:** P12 (pet store, PetApp, usePetWindow)

---

## Problems with P21 approach

P21 only synced emotion. Pet window still owned card logic:

1. **Filter out of sync** — Pet window has its own `filterStore` instance. Hydrates from DB at start but does NOT sync when user changes filter in main window. Same token can pass filter in main but fail in pet → card never shows.

2. **Dual timers** — Main window has 10s timer to restore emotion after `alert`. Pet window has separate 10s timer to close card. Both independent → can drift → inconsistency.

3. **Duplicate `token_detected` listener** — Both windows listen, both check filter, both run logic. No single source of truth.

4. **Dashboard animation unnecessary** — `MiniPet` and `PetDrawer` use `PetSprite` with CSS animation running continuously. Confusing, wastes render cycles. Only the desktop overlay needs to animate.

---

## Design

**Main window** = single source of truth for all pet logic:
- Filter check
- Emotion state machine
- Card trigger timing

**Pet window** = dumb renderer:
- No filter knowledge
- No business logic
- Just listens to 2 events and renders

```
Main window
  ├── token_detected → matchesFilter?
  │     yes → setEmotion('alert')
  │          → emitTo('pet', 'pet_emotion', { emotion: 'alert' })
  │          → emitTo('pet', 'pet_show_card', { token })
  │          → setTimeout 10s:
  │                restorePrev()
  │                emitTo('pet', 'pet_emotion', { emotion: prevEmotion })
  │                emitTo('pet', 'pet_hide_card')
  │     no  → skip
  ├── buy_confirmed → setEmotion + emitTo pet_emotion
  ├── price_updated → setEmotion + emitTo pet_emotion
  └── position_closed → setEmotion + emitTo pet_emotion + restore after timer

Pet window (PetApp.tsx)
  ├── listen('pet_emotion')    → setEmotion in local store → PetSprite re-renders
  ├── listen('pet_show_card')  → setActiveToken + setCardOpen(true) + openCard()
  └── listen('pet_hide_card')  → setCardOpen(false) + closeCard()
```

---

## Implementation

### T22.1 — `src/store/pet.ts`

**Add imports:**
```typescript
import { listen, emitTo } from '@tauri-apps/api/event'
```

**Add sync helpers** (before `setupPetEventListeners`):
```typescript
function syncEmotion(emotion: PetEmotion) {
  emitTo('pet', 'pet_emotion', { emotion }).catch(() => {})
}

function syncShowCard(token: DetectedToken) {
  emitTo('pet', 'pet_show_card', { token }).catch(() => {})
}

function syncHideCard() {
  emitTo('pet', 'pet_hide_card', {}).catch(() => {})
}
```

**Rewrite `setupPetEventListeners()`:**

```typescript
listen<DetectedToken>('token_detected', (event) => {
  const filter = useFilterStore.getState().filter
  if (!matchesFilter(event.payload, filter)) return

  const store = usePetStore.getState()
  store.setEmotion('alert')
  syncEmotion('alert')
  syncShowCard(event.payload)   // ← pet window shows card
  store.gainTokenXp()

  setTimeout(() => {
    store.restorePrev()
    syncEmotion(usePetStore.getState().emotion)
    syncHideCard()              // ← pet window hides card
  }, 10_000)
})

listen('buy_confirmed', () => {
  const store = usePetStore.getState()
  store.setEmotion('invested')
  syncEmotion('invested')
  store.gainBuyXp()
})

listen<{ mint: string; price_usd: number }>('price_updated', () => {
  const store = usePetStore.getState()
  if (store.emotion === 'shrug' || store.emotion === 'celebration') return

  const positions = usePortfolioStore.getState().positions
  if (positions.length === 0) return

  let nearSl = false
  let allPumping = true
  for (const p of positions) {
    const price = p.current_price_usd
    if (price == null) { allPumping = false; continue }
    const pnlPct = ((price - p.entry_price_usd) / p.entry_price_usd) * 100
    const slPct = p.stop_loss_pct ?? DEFAULT_SL_PCT
    const slThreshold = p.entry_price_usd * (1 - slPct / 100)
    if (price <= slThreshold * 1.1) nearSl = true
    if (pnlPct <= 20) allPumping = false
  }

  if (nearSl) {
    store.setEmotion('watching'); syncEmotion('watching')
  } else if (allPumping) {
    store.setEmotion('pumping'); syncEmotion('pumping')
  } else {
    store.setEmotion('invested'); syncEmotion('invested')
  }
})

listen<{ realized_pnl_pct: number }>('position_closed', (e) => {
  const store = usePetStore.getState()
  const emotion = e.payload.realized_pnl_pct > 0 ? 'celebration' : 'shrug'
  store.setEmotion(emotion)
  syncEmotion(emotion)
  store.gainCloseXp()
  const duration = emotion === 'celebration' ? 5000 : 3000
  setTimeout(() => {
    store.restorePrev()
    syncEmotion(usePetStore.getState().emotion)
  }, duration)
})
```

---

### T22.2 — `src/components/pet/PetApp.tsx`

**Remove** entire `token_detected` useEffect block.

**Replace with** 3 new listeners:

```typescript
// pet_emotion — update local store so PetSprite re-renders
useEffect(() => {
  let unlisten: (() => void) | null = null
  let cancelled = false
  listen<{ emotion: PetEmotion }>('pet_emotion', (e) => {
    usePetStore.getState().setEmotion(e.payload.emotion)
  }).then((fn) => { if (cancelled) fn(); else unlisten = fn })
  return () => { cancelled = true; unlisten?.() }
}, [])

// pet_show_card — main window decided this token should show
useEffect(() => {
  let unlisten: (() => void) | null = null
  let cancelled = false
  listen<{ token: DetectedToken }>('pet_show_card', (e) => {
    setActiveToken(e.payload.token)
    setCardOpen(true)
    openCardRef.current()
  }).then((fn) => { if (cancelled) fn(); else unlisten = fn })
  return () => { cancelled = true; unlisten?.() }
}, [])

// pet_hide_card — main window's 10s timer fired
useEffect(() => {
  let unlisten: (() => void) | null = null
  let cancelled = false
  listen('pet_hide_card', () => {
    setCardOpen(false)
    closeCardRef.current()
  }).then((fn) => { if (cancelled) fn(); else unlisten = fn })
  return () => { cancelled = true; unlisten?.() }
}, [])
```

**Remove** `filterRef` and `hydrate` — no longer needed in pet window.

---

### T22.3 — `src/components/pet/PetSprite.tsx`

Add `animated` prop. Default `false` so dashboard instances are static:

```typescript
interface Props {
  emotion: PetEmotion
  size?: number
  flip?: boolean
  animated?: boolean   // ← new, default false
}

export function PetSprite({ emotion, size = 64, flip = false, animated = false }: Props) {
  // ...
  return (
    <div style={{ width: size, height: displayH, overflow: 'hidden', ... }}>
      <div
        style={{
          // ...
          animation: animated
            ? `pet-sprite-${emotion} ${duration}s steps(${cfg.frames}) ${cfg.loop ? 'infinite' : '1 forwards'}`
            : undefined,
        }}
      />
    </div>
  )
}
```

---

### T22.4 — `src/components/pet/PetApp.tsx`

Pass `animated={true}` to the PetSprite in pet window:

```tsx
<PetSprite emotion={emotion} size={92} flip={facing === -1} animated />
```

---

### T22.5 — Dashboard components (static sprites)

`MiniPet.tsx` and `PetDrawer.tsx` already don't pass `animated` → default `false` → static.

No change needed if T22.3 default is `false`.

---

## What gets removed / simplified

| Before | After |
|---|---|
| Pet window listens to `token_detected` | Removed |
| Pet window imports `filterStore`, `matchesFilter` | Removed |
| Pet window calls `hydrate()` | Removed |
| 2 independent 10s timers (main + pet) | 1 timer in main, pet follows commands |
| MiniPet animates continuously | Static sprite |
| PetDrawer animates continuously | Static sprite |

---

## Checklist

- [ ] T22.1: `syncEmotion`, `syncShowCard`, `syncHideCard` helpers in `pet.ts`
- [ ] T22.1: All 4 event handlers emit to pet window
- [ ] T22.2: Remove `token_detected` listener from `PetApp.tsx`
- [ ] T22.2: Remove `filterStore`/`hydrate`/`matchesFilter` from `PetApp.tsx`
- [ ] T22.2: Add `pet_emotion`, `pet_show_card`, `pet_hide_card` listeners
- [ ] T22.3: `PetSprite` gains `animated` prop, default `false`
- [ ] T22.4: `PetApp.tsx` passes `animated` to its PetSprite
- [ ] Test: Token detected (pass filter) → desktop capy goes `alert`, card opens
- [ ] Test: 10s → card closes, emotion restores — both happen together
- [ ] Test: Token filtered out → nothing happens in pet window
- [ ] Test: MiniPet sprite is static (no animation running)
- [ ] Test: PetDrawer sprite is static
- [ ] Test: Buy → desktop capy `invested`
- [ ] Test: SL hit → `shrug` 3s → restore
- [ ] Test: Win sell → `celebration` 5s → restore
