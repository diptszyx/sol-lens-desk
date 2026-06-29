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
  const chartRef = useRef<any>(null)
  const seriesRef = useRef<any>(null)
  const [tf, setTf] = useState<Timeframe>(5)
  const [status, setStatus] = useState<'loading' | 'ok' | 'empty'>('loading')

  useEffect(() => {
    if (!containerRef.current) return
    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#b4b4d4',
      },
      grid: { vertLines: { color: '#252540' }, horzLines: { color: '#252540' } },
      crosshair: {
        vertLine: { color: '#333358', style: 2, width: 1, labelBackgroundColor: '#161628' },
        horzLine: { color: '#333358', style: 2, width: 1, labelBackgroundColor: '#161628' },
      },
      timeScale: { borderColor: '#252540', timeVisible: true, secondsVisible: false },
      rightPriceScale: { borderColor: '#252540' },
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

  useEffect(() => {
    if (!seriesRef.current) return
    let retryTimer: ReturnType<typeof setTimeout> | null = null

    function fetchCandles() {
      setStatus('loading')
      fetch(`https://frontend-api.pump.fun/candlesticks/${mint}?offset=0&limit=200&timeframe=${tf}`)
        .then((r) => r.json())
        .then((candles: OhlcvCandle[]) => {
          if (candles.length < 2) {
            setStatus('empty')
            retryTimer = setTimeout(fetchCandles, 15_000)
            return
          }
          seriesRef.current!.setData(
            candles.map((c) => ({
              time: c.timestamp as any,
              open: c.open, high: c.high, low: c.low, close: c.close,
            }))
          )
          chartRef.current!.timeScale().fitContent()
          setStatus('ok')
        })
        .catch(() => {
          setStatus('empty')
          retryTimer = setTimeout(fetchCandles, 15_000)
        })
    }

    fetchCandles()
    return () => { if (retryTimer) clearTimeout(retryTimer) }
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
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
            <p className="text-xs text-[var(--text-3)]">No chart data yet</p>
            <p className="text-[10px] text-[var(--text-3)] opacity-60">retrying in 15s…</p>
          </div>
        )}
        <div ref={containerRef} style={{ height: 200, visibility: status === 'ok' ? 'visible' : 'hidden' }} />
      </div>
    </div>
  )
}
