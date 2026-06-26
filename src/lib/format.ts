export function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  return `${Math.floor(seconds / 3600)}h`
}

export function formatSol(sol: number): string {
  if (sol >= 1000) return `${(sol / 1000).toFixed(1)}k`
  return sol.toFixed(2)
}

/** Readable price for meme tokens — avoids raw JS scientific notation. */
export function formatPrice(usd: number): string {
  if (usd === 0) return '$0'
  if (usd >= 1) return `$${usd.toFixed(2)}`
  if (usd >= 0.01) return `$${usd.toFixed(4)}`
  if (usd >= 0.0001) return `$${usd.toFixed(6)}`
  // For very small numbers use compact notation: $4.25e-6 → show clearly
  const exp = Math.floor(Math.log10(usd))
  const mantissa = usd / Math.pow(10, exp)
  return `$${mantissa.toFixed(2)}e${exp}`
}

export function formatUsd(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`
  return `$${v.toFixed(0)}`
}
