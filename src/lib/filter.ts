import type { DetectedToken, FilterConfig } from '../types'

export function matchesFilter(token: DetectedToken, f: FilterConfig): boolean {
  if (f.hideUnnamed) {
    const sym = token.symbol?.trim()
    if (!sym || sym === '?') return false
  }

  // age_seconds from Rust is hardcoded 0; derive from detected_at instead.
  const ageSec = (Date.now() - token.detected_at) / 1000
  if (f.maxAgeSec != null && ageSec > f.maxAgeSec) return false
  if (f.minLiquiditySol != null && token.liquidity_sol < f.minLiquiditySol) return false
  if (token.score < f.minScoreThreshold) return false

  if (f.search.trim()) {
    const q = f.search.trim().toLowerCase()
    const hay = `${token.symbol ?? ''} ${token.name ?? ''} ${token.mint}`.toLowerCase()
    if (!hay.includes(q)) return false
  }

  return true
}
