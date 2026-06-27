import type { DetectedToken, FilterConfig } from '../types'

export function matchesFilter(token: DetectedToken, f: FilterConfig): boolean {
  if (f.hideUnnamed) {
    const sym = token.symbol?.trim()
    if (!sym || sym === '?') return false
  }

  if (f.maxAgeSec != null && token.age_seconds > f.maxAgeSec) return false
  if (f.minLiquiditySol != null && token.liquidity_sol < f.minLiquiditySol) return false
  if (token.score < f.minScoreThreshold) return false

  if (f.search.trim()) {
    const q = f.search.trim().toLowerCase()
    const hay = `${token.symbol ?? ''} ${token.name ?? ''} ${token.mint}`.toLowerCase()
    if (!hay.includes(q)) return false
  }

  return true
}
