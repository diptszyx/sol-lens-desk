# Plan 14: Price Chart (pump.fun OHLCV)

## Vấn đề hiện tại

`PriceChart.tsx` đang dùng DexScreener iframe — data không đúng với new token, không controlled, không style được.

## Nguồn data: pump.fun Candlesticks API

```
GET https://frontend-api.pump.fun/candlesticks/{mint}
    ?offset=0&limit=200&timeframe=1
```

- Không cần API key
- Data từ giây đầu token tạo ra (bonding curve)
- `timeframe`: `1` = 1 phút, `5` = 5 phút, `15` = 15 phút, `60` = 1 giờ
- Response: array of `{ open, high, low, close, volume, timestamp }` (timestamp là Unix seconds)

Đây là API pump.fun dùng cho chart của chính họ — đủ tin cậy.

## Approach

Không cần API key → gọi thẳng từ frontend. Tauri webview không bị CORS, CSP `connect-src https://*` đã cover `frontend-api.pump.fun`.

```
Frontend (PriceChart.tsx)
  fetch pump.fun/candlesticks/{mint}?timeframe={tf}
        ↓
lightweight-charts CandlestickSeries render
```

## Frontend side

### `src/components/token-detail/PriceChart.tsx` (rewrite)

- Import: `lightweight-charts` (đã có trong project)
- State: `timeframe: 1 | 5 | 15 | 60`
- Effect: `fetch` pump.fun API khi mint hoặc timeframe đổi
- Render: `CandlestickSeries` với màu terminal theme
- Loading state: spinner
- Empty state: "No chart data yet" (token quá mới chưa có candle)

```tsx
import { useEffect, useRef, useState } from 'react'
import { createChart, ColorType, CandlestickSeries } from 'lightweight-charts'

interface OhlcvCandle {
  timestamp: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

type Timeframe = 1 | 5 | 15 | 60
const TIMEFRAMES: { key: Timeframe; label: string }[] = [
  { key: 1, label: '1m' },
  { key: 5, label: '5m' },
  { key: 15, label: '15m' },
  { key: 60, label: '1h' },
]

interface Props {
  mint: string
  currentPrice: number | null
}

export function PriceChart({ mint, currentPrice }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef(null)
  const seriesRef = useRef(null)
  const [tf, setTf] = useState<Timeframe>(5)
  const [status, setStatus] = useState<'loading' | 'ok' | 'empty'>('loading')

  // Init chart once
  useEffect(() => {
    if (!containerRef.current) return
    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#8888aa',
      },
      grid: { vertLines: { color: '#1e1e35' }, horzLines: { color: '#1e1e35' } },
      crosshair: {
        vertLine: { color: '#2a2a45', style: 2, width: 1, labelBackgroundColor: '#16162a' },
        horzLine: { color: '#2a2a45', style: 2, width: 1, labelBackgroundColor: '#16162a' },
      },
      timeScale: { borderColor: '#1e1e35', timeVisible: true, secondsVisible: false },
      rightPriceScale: { borderColor: '#1e1e35' },
      width: containerRef.current.clientWidth,
      height: 200,
    })
    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#00ff88', downColor: '#ff4444',
      borderUpColor: '#00ff88', borderDownColor: '#ff4444',
      wickUpColor: '#00ff88', wickDownColor: '#ff4444',
    })
    chartRef.current = chart
    seriesRef.current = series

    const handleResize = () => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth })
    }
    window.addEventListener('resize', handleResize)
    return () => { window.removeEventListener('resize', handleResize); chart.remove() }
  }, [])

  // Fetch data when mint or timeframe changes
  useEffect(() => {
    if (!seriesRef.current) return
    setStatus('loading')
    fetch(`https://frontend-api.pump.fun/candlesticks/${mint}?offset=0&limit=200&timeframe=${tf}`)
      .then((r) => r.json())
      .then((candles: OhlcvCandle[]) => {
        if (candles.length < 2) { setStatus('empty'); return }
        seriesRef.current!.setData(
          candles.map((c) => ({
            time: c.timestamp as any,
            open: c.open, high: c.high, low: c.low, close: c.close,
          }))
        )
        chartRef.current!.timeScale().fitContent()
        setStatus('ok')
      })
      .catch(() => setStatus('empty'))
  }, [mint, tf])

  return (
    <div className="border-b border-[var(--border)] flex-shrink-0 bg-[var(--bg-base)]">
      <div className="flex items-center justify-between px-3 pt-2.5">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-3)]">Chart</p>
        <div className="flex gap-0.5">
          {TIMEFRAMES.map(({ key, label }) => (
            <button key={key} onClick={() => setTf(key)}
              className={`text-[10px] px-2 py-0.5 rounded transition-colors ${
                tf === key
                  ? 'text-[var(--accent)] bg-[var(--accent)]/10 border border-[var(--accent)]/20'
                  : 'text-[var(--text-3)] hover:text-[var(--text-1)]'
              }`}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="px-1 pb-2" style={{ height: 200, position: 'relative' }}>
        {status === 'loading' && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-4 h-4 rounded-full border-2 border-[var(--border)] border-t-[var(--accent)] animate-spin" />
          </div>
        )}
        {status === 'empty' && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-xs text-[var(--text-3)]">No chart data yet</p>
          </div>
        )}
        <div ref={containerRef} style={{ height: 200, visibility: status === 'ok' ? 'visible' : 'hidden' }} />
      </div>
    </div>
  )
}
```

## Files thay đổi

| File | Thay đổi |
|------|----------|
| `src/components/token-detail/PriceChart.tsx` | **REWRITE** — `fetch` pump.fun trực tiếp + lightweight-charts render |
| `src-tauri/tauri.conf.json` | **REVERT** CSP — bỏ `https://dexscreener.com` khỏi frame-src |

## Edge cases

- Token vừa launch chưa có candle → `status = 'empty'` → hiển thị "No chart data yet"
- pump.fun API down → error → `status = 'empty'`  
- Token graduate sang Raydium → pump.fun vẫn có historical data của bonding curve phase
- Cache 30s → đổi timeframe thì hit network, chọn lại cùng timeframe thì instant

## Không cần

- GeckoTerminal (pump.fun đủ rồi)
- Birdeye (overkill cho usecase này)
- DexScreener
- API key bất kỳ

## Thứ tự implement

1. Rewrite `PriceChart.tsx` — fetch pump.fun + lightweight-charts
2. Revert CSP — bỏ `https://dexscreener.com` khỏi frame-src
3. Test với token mới trên pump.fun
