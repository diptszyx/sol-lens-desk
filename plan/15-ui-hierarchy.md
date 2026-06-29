# Plan 15 — UI Hierarchy & Navigation Architecture

Bổ sung cho [13-redesign.md](./13-redesign.md) Phase 2+5. Giải quyết 2 vấn đề chưa cover:
1. Sidebar rail navigation (pet system tách riêng)
2. Contrast/hierarchy thực sự thấp dù tokens đã có

---

## Vấn đề hiện tại

### A. Contrast quá thấp

`tokens.css` hiện tại có 4 bg layers nhưng difference quá nhỏ:

```
--bg-deep:    #0d0d1b   L≈6%
--bg-base:    #111120   L≈8%   ← +2%
--bg-surface: #161628   L≈10%  ← +2%
--bg-elevated:#1c1c32   L≈13%  ← +3%
```

Mắt không phân biệt được `bg-base` vs `bg-surface`. Layout nhìn flat.

### B. Pet system sai surface

Plan 13 để pet icon `[🐻 1]` trong titlebar header → click vào đâu? Pet là meta-game hoàn toàn khác, không cần real-time cùng feed. Nhưng plan 13 chưa define surface pet sẽ render ở đâu.

---

## Fix A — Contrast steps rõ hơn

Tăng step giữa các layer. Dùng oklch để đảm bảo perceptual uniformity:

```css
/* src/styles/tokens.css — thay phần bg */

:root {
  /* Background layers — step ~4-5% L mỗi bậc */
  --bg-deep:    oklch(7%  0.02 265);   /* app chrome, titlebar */
  --bg-base:    oklch(11% 0.02 265);   /* main columns */
  --bg-surface: oklch(16% 0.02 265);   /* cards, panels */
  --bg-elevated:oklch(21% 0.02 265);   /* hover, selected, dropdown */

  /* Border — đủ visible, không noise */
  --border:       oklch(28% 0.03 265);
  --border-strong:oklch(35% 0.03 265);

  /* Text — 3 clear tiers */
  --text-1: oklch(96% 0.01 265);   /* primary data: price, PnL, symbol */
  --text-2: oklch(65% 0.02 265);   /* secondary: labels, metadata */
  --text-3: oklch(40% 0.02 265);   /* muted: timestamp, noise */
}
```

**Rule áp dụng:**

| Element | Background | Text |
|---------|-----------|------|
| App frame, titlebar | `--bg-deep` | — |
| Feed/portfolio columns | `--bg-base` | — |
| Token row | `--bg-base` | — |
| Token row (hover) | `--bg-elevated` | — |
| Panel, card | `--bg-surface` | — |
| Detail card, stat box | `--bg-elevated` | — |
| Price/PnL/symbol | — | `--text-1` + `font-mono` |
| Labels, source | — | `--text-2` |
| Time, noise | — | `--text-3` |

---

## Fix B — Navigation architecture

### Thay đổi layout: thêm sidebar rail

Plan 13 Phase 2 có layout 3-column nhưng không có điểm navigation chính. Thêm sidebar rail 40px phía trái:

```
┌────┬──────────────┬──────────────────────────┬──────────────────┐
│    │   FEED       │   TOKEN DETAIL           │   PORTFOLIO      │
│ ◎  │   280px      │   flex-1                 │   300px          │
│    │              │                          │                  │
│ 🔍 │  [⚙] 12/48  │  $SYMBOL  pump_fun  2m  │  2Yqap...4jSTVf  │
│    │  ──────────  │  $0.000042               │  2.4521 ◎        │
│ 🐾 │  TokenRow    │                          │  ───────────     │
│    │  TokenRow    │  Stats grid              │  OPEN (2)        │
│ ⚙️  │  TokenRow    │  [Chart]                 │  PositionCard    │
│    │  ...         │  [TradePanel]            │  PositionCard    │
│    │              │                          │  ───────────     │
│    │              │                          │  HISTORY         │
└────┴──────────────┴──────────────────────────┴──────────────────┘
  40px
```

**Rail icons:**
- `◎` (Solana logo) — branding, non-clickable
- `🔍` — Trading view (default, luôn active khi mở app)
- `🐾` — Pet surface
- `⚙️` — Settings

Active icon: border-left accent line + icon color `--accent`. Inactive: `--text-3`.

### Pet surface — Full surface switch

Click 🐾 → **toàn bộ main area** thay bằng Pet Dashboard. Không phải drawer, không overlay.

```
Trading view (🔍 active):
┌────┬──────────────┬──────────────────────────┬──────────────────┐
│ ◎  │   FEED       │   TOKEN DETAIL           │   PORTFOLIO      │
│ 🔍●│              │                          │                  │
│ 🐾 │  ...         │  ...                     │  ...             │
│ ⚙️  │              │                          │                  │
└────┴──────────────┴──────────────────────────┴──────────────────┘

Pet view (🐾 active):
┌────┬──────────────────────────────────────────────────────────────┐
│ ◎  │                                                              │
│ 🔍 │                    PET DASHBOARD                            │
│ 🐾●│   [XP bar]  [pets grid]  [accessories]                      │
│ ⚙️  │                                                              │
└────┴──────────────────────────────────────────────────────────────┘
```

**App state:** `activeSurface: 'trading' | 'pet' | 'settings'`

**Pet Dashboard layout:**
```
┌─────────────────────────────────────────────────────────────────┐
│  🐾 Pet System              Level 7  ████████░░  XP 720/1000    │
├──────────────────────────────┬──────────────────────────────────┤
│  MY PETS (3)                 │  ACCESSORIES                     │
│                              │                                  │
│  ┌──────┐ ┌──────┐ ┌──────┐ │  Hat       [none ▾]              │
│  │ img  │ │ img  │ │ img  │ │  Outfit    [Mechanic ▾]          │
│  │      │ │      │ │      │ │  Badge     [Gold ▾]              │
│  │ Mech │ │ Mech │ │ Mech │ │                                  │
│  │ #1   │ │ #2   │ │ #3   │ │  [Equip selected pet]            │
│  └──────┘ └──────┘ └──────┘ │                                  │
│  [active]                   │                                  │
└──────────────────────────────┴──────────────────────────────────┘
```

**Pet card (placeholder):** SVG placeholder 80×80px với mechanic theme (gear icon + pet silhouette). Thay bằng real art sau.

---

## Token row — Hover pattern

BUY button ẩn mặc định, chỉ show khi hover row:

```
Default:
┌─────────────────────────────────────────────────────────┐
│  $PEPE          pump.fun · 2m ago         +420%  $84K   │
└─────────────────────────────────────────────────────────┘

Hover:
┌─────────────────────────────────────────────────────────┐
│  $PEPE          pump.fun · 2m ago         +420%  [BUY]  │
└─────────────────────────────────────────────────────────┘
```

- `$84K` MC → hide khi hover, replace bằng `[BUY]`
- `[BUY]` = `bg-accent text-black font-mono font-bold text-xs px-3 py-1 rounded`
- Transition: `opacity 150ms ease-out`

---

## Files thay đổi

### A — Contrast fix (nhỏ, standalone)
- `src/styles/tokens.css` — replace bg + border + text tokens với oklch values

### B — Sidebar rail
- `src/App.tsx` — thêm rail 40px, manage `activeSurface` state
- `src/components/layout/SideRail.tsx` — NEW: icon rail component
- `src/components/layout/PetDrawer.tsx` — NEW: drawer wrapper cho pet surface
- `src/components/pet/PetView.tsx` — hiện tại ở đâu thì move vào đây

### C — Token row hover
- `src/components/token-feed/TokenRow.tsx` — hover state, ẩn/hiện BUY

---

## Execution order

```
Step 1: tokens.css oklch fix          ← nhanh, standalone, visual win ngay
Step 2: TokenRow hover pattern        ← nhỏ, 1 file
Step 3: SideRail component            ← sau khi Plan 13 Phase 2 (3-col) xong
Step 4: PetDrawer                     ← cần SideRail xong trước
```

Step 1+2 có thể làm ngay mà không cần đợi Plan 13 Phase 2 layout overhaul.
