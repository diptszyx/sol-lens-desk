# P2: Filter

**Depends on:** P1 (T1.3 score, T1.4 TypeScript types)  
**Ref:** [FILTER.md](../FILTER.md), [SIGNAL_RESEARCH.md](../SIGNAL_RESEARCH.md)

---

## T2.1 — matchesFilter() Logic

**Files:** `src/lib/filter.ts` (tạo mới hoặc cập nhật nếu đã có)

**What to do:**

Rewrite filter logic theo FilterConfig mới:

```typescript
export function matchesFilter(token: DetectedToken, config: FilterConfig): boolean {
  if (config.hideUnnamed && !token.symbol) return false
  if (config.maxAgeSec != null && token.age_seconds > config.maxAgeSec) return false
  if (config.minLiquiditySol != null && token.liquidity_sol < config.minLiquiditySol) return false
  if (token.score < config.minScoreThreshold) return false
  if (config.search) {
    const q = config.search.toLowerCase()
    const sym = token.symbol?.toLowerCase() ?? ''
    const name = token.name?.toLowerCase() ?? ''
    if (!sym.includes(q) && !name.includes(q) && !token.mint.includes(q)) return false
  }
  return true
}
```

**Note:** Hard gates (mint/freeze authority) đã block ở backend — không cần check lại ở frontend.

---

## T2.2 — Filter Store Update

**Files:** `src/store/filter.ts`

**What to do:**
1. Xóa old fields: `maxDevHoldPct`, `minDevBuySol`, `maxMcapUsd`, `minBondingCurvePct`, `requireSocials`, `sources`
2. Thêm `minScoreThreshold: number` (default: 55)
3. Update store defaults

---

## T2.3 — FilterPanel UI Rebuild

**Files:** `src/components/filter/FilterPanel.tsx`

**What to do:**

Rebuild hoàn toàn theo mockup trong [FILTER.md](../FILTER.md):

```
┌──────────────────────────────────────────┐
│  [Degen·30]  [● Balanced·55]  [Safe·75]  │  ← preset chips
│                                           │
│  Score   ●──────────────  55             │  ← slider 0-100
│                                           │
│  Max age      [ 5 min  ]                 │
│  Min liq      [ 5 SOL  ]                 │
│  Hide unnamed   [✓]                      │
└──────────────────────────────────────────┘
```

Behavior:
- Preset chips set slider value và highlight chip
- Slider change → deselect all chips (custom)
- Search bar ở token feed header (không trong panel này)

---

## T2.4 — Score Badge on TokenRow

**Files:** `src/components/token-feed/` (tìm TokenRow component)

**What to do:**

Thêm score badge vào mỗi row:
```
$PEPE  [72]  $0.0001  45% curve  3.2 SOL  12s ago
```

Badge color:
- `score >= 70` → green
- `score >= 40` → yellow  
- `score < 40` → red

---

## T2.5 — Score Display on PetCard

**Files:** `src/components/pet/PetCard.tsx`

**What to do:**

Thêm score prominent ở PetCard:
```
🚨 $PEPE          Score: 72/100
Dev: 3% · Curve: 45% · Buy: 1.2◎
[0.1◎]  [0.5◎]  [1◎]       [BUY]
```

Score line: số lớn, màu tương ứng green/yellow/red.

---

## Checklist P2

- [ ] T2.1: matchesFilter() dùng score threshold, không còn old fields
- [ ] T2.2: filter store chỉ còn minScoreThreshold + 3 utility fields
- [ ] T2.3: FilterPanel có preset chips + slider, xóa 6 old fields
- [ ] T2.4: TokenRow có score badge với màu đúng
- [ ] T2.5: PetCard hiển thị score prominently
- [ ] Test: token có score 30 bị filter với threshold 55
- [ ] Test: token có mint authority active không xuất hiện trong feed
