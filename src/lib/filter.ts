import type { DetectedToken, FilterConfig } from '../types'

/** Pure predicate: does a token pass the user's filter? */
export function matchesFilter(token: DetectedToken, f: FilterConfig): boolean {
  if (f.hideUnnamed) {
    const sym = token.symbol?.trim()
    if (!sym || sym === '?') return false
  }

  if (f.sources && !f.sources.includes(token.source)) return false

  if (f.search.trim()) {
    const q = f.search.trim().toLowerCase()
    const hay = `${token.symbol ?? ''} ${token.name ?? ''} ${token.mint}`.toLowerCase()
    if (!hay.includes(q)) return false
  }

  if (f.maxAgeSec != null && token.age_seconds > f.maxAgeSec) return false
  if (f.minLiquiditySol != null && token.liquidity_sol < f.minLiquiditySol) return false

  // Threshold checks below treat missing data as a fail when the user opted in,
  // so a filter the token can't prove it satisfies hides it (safer for trading).
  if (f.maxDevHoldPct != null && !(token.dev_hold_pct != null && token.dev_hold_pct <= f.maxDevHoldPct)) return false
  if (f.minDevBuySol != null && !(token.dev_buy_sol != null && token.dev_buy_sol >= f.minDevBuySol)) return false
  if (f.maxMcapUsd != null && !(token.market_cap_usd != null && token.market_cap_usd <= f.maxMcapUsd)) return false
  if (f.minBondingCurvePct != null && !(token.bonding_curve_pct != null && token.bonding_curve_pct >= f.minBondingCurvePct)) return false
  if (f.requireSocials && token.has_socials !== true) return false

  return true
}
