import { useEffect } from 'react'
import { usePortfolioStore } from '../store/portfolio'

const JUPITER_PRICE_URL = 'https://api.jup.ag/price/v2'

export function usePricePoll() {
  const positions = usePortfolioStore((s) => s.positions)
  const updatePrices = usePortfolioStore((s) => s.updatePrices)

  useEffect(() => {
    if (positions.length === 0) return

    const poll = async () => {
      const mints = positions.map((p) => p.mint).join(',')
      try {
        const resp = await fetch(`${JUPITER_PRICE_URL}?ids=${mints}`)
        const data = await resp.json()
        const prices: Record<string, number> = {}
        for (const [mint, info] of Object.entries(
          data.data as Record<string, { price: string }>,
        )) {
          prices[mint] = parseFloat(info.price)
        }
        updatePrices(prices)
      } catch {
        // silent — prices just won't update this tick
      }
    }

    poll()
    const id = setInterval(poll, 10_000)
    return () => clearInterval(id)
  }, [positions.length])
}
