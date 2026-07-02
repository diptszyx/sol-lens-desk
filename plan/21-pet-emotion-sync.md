# P21: Pet Emotion Sync — Main-to-Pet Window Bridge

**Status:** Planned  
**Depends on:** P12 (pet store, setupPetEventListeners)  
**Ref:** [PET.md](../docs/PET.md)

---

## Problem

Tauri = mỗi window = 1 WebView riêng = JS context hoàn toàn độc lập. Zustand store ở main window và pet window không share memory.

Hiện tại:
- `setupPetEventListeners()` chỉ gọi trong `App.tsx` (main window) → chỉ main window store được update
- `PetApp.tsx` (pet window) không gọi `setEmotion` ở đâu cả
- Pet window store luôn ở `emotion: 'idle'` — không bao giờ đổi

**Kết quả:** Desktop capybara luôn idle, không phản ánh trạng thái trading.

---

## Design: Option B — Single Source of Truth

Main window owns toàn bộ state machine logic. Pet window chỉ mirror emotion qua Tauri event.

```
Main window (App.tsx)
  ├── setupPetEventListeners()   ← tính toán state
  ├── usePetStore (main)         ← source of truth
  └── emitTo('pet', 'pet_emotion', { emotion })   ← broadcast khi thay đổi
        ↓
Pet window (PetApp.tsx)
  ├── listen('pet_emotion')      ← nhận emotion từ main
  └── usePetStore (pet)          ← dumb mirror, chỉ dùng để render
```

Pet window không cần biết gì về trading logic, position PnL, hay SL threshold.

---

## Implementation

### T21.1 — `src/store/pet.ts`

**Thêm import:**
```typescript
import { listen, emitTo } from '@tauri-apps/api/event'
```

**Thêm helper** (đặt trước `setupPetEventListeners`):
```typescript
function syncToPetWindow(emotion: PetEmotion) {
  emitTo('pet', 'pet_emotion', { emotion }).catch(() => {})
}
```

**Sửa `setupPetEventListeners()`** — thêm sync sau mỗi emotion change:

```typescript
listen<DetectedToken>('token_detected', (event) => {
  const filter = useFilterStore.getState().filter
  if (!matchesFilter(event.payload, filter)) return

  const store = usePetStore.getState()
  store.setEmotion('alert')
  syncToPetWindow('alert')                          // ← thêm
  store.gainTokenXp()
  setTimeout(() => {
    store.restorePrev()
    syncToPetWindow(usePetStore.getState().emotion) // ← thêm (sau restore)
  }, 10_000)
})

listen('buy_confirmed', () => {
  const store = usePetStore.getState()
  store.setEmotion('invested')
  syncToPetWindow('invested')                       // ← thêm
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
    store.setEmotion('watching')
    syncToPetWindow('watching')                     // ← thêm
  } else if (allPumping) {
    store.setEmotion('pumping')
    syncToPetWindow('pumping')                      // ← thêm
  } else {
    store.setEmotion('invested')
    syncToPetWindow('invested')                     // ← thêm
  }
})

listen<{ realized_pnl_pct: number }>('position_closed', (e) => {
  const store = usePetStore.getState()
  const emotion = e.payload.realized_pnl_pct > 0 ? 'celebration' : 'shrug'
  store.setEmotion(emotion)
  syncToPetWindow(emotion)                          // ← thêm
  store.gainCloseXp()
  const duration = emotion === 'celebration' ? 5000 : 3000
  setTimeout(() => {
    store.restorePrev()
    syncToPetWindow(usePetStore.getState().emotion) // ← thêm (sau restore)
  }, duration)
})
```

---

### T21.2 — `src/components/pet/PetApp.tsx`

**Thêm import:**
```typescript
import type { PetEmotion } from '../../store/pet'
```

**Thêm useEffect** (đặt sau các useEffect hiện có):
```typescript
useEffect(() => {
  let unlisten: (() => void) | null = null
  let cancelled = false

  listen<{ emotion: PetEmotion }>('pet_emotion', (e) => {
    usePetStore.getState().setEmotion(e.payload.emotion)
  }).then((fn) => {
    if (cancelled) fn()
    else unlisten = fn
  })

  return () => {
    cancelled = true
    unlisten?.()
  }
}, [])
```

`token_detected` handler trong `PetApp.tsx` **giữ nguyên** — nó chỉ quản lý PetCard display và window resize, không liên quan emotion state.

---

## Không thay đổi

- `usePetTradeBridge.ts` — giữ nguyên (emit `buy_confirmed`, `position_closed` từ trade flow)
- `WalkingPet.tsx` — giữ nguyên (dùng trong main dashboard, không phải pet window)
- `PetSprite.tsx` — giữ nguyên
- `usePetWindow.ts` — giữ nguyên
- SQLite / XP persistence — giữ nguyên (chỉ chạy ở main window)

---

## Checklist

- [ ] T21.1: Import `emitTo` vào `pet.ts`
- [ ] T21.1: Thêm `syncToPetWindow` helper
- [ ] T21.1: Sync sau `token_detected` → setEmotion + restorePrev
- [ ] T21.1: Sync sau `buy_confirmed` → setEmotion
- [ ] T21.1: Sync sau `price_updated` → 3 nhánh setEmotion
- [ ] T21.1: Sync sau `position_closed` → setEmotion + restorePrev
- [ ] T21.2: Thêm `listen('pet_emotion')` vào `PetApp.tsx`
- [ ] Test: Buy token → desktop capy đổi sang `invested`
- [ ] Test: Position +25% → desktop capy đổi sang `pumping`
- [ ] Test: SL hit → desktop capy `shrug` 3s → restore
- [ ] Test: Win sell → desktop capy `celebration` 5s → restore
- [ ] Test: Token detected → desktop capy `alert` 10s → restore
