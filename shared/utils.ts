export function normalizeSymbol(raw: string): string {
  return raw.trim().replace(/^\$/, '').toUpperCase()
}

export function truncateAddress(addr: string, lead = 4, tail = 4): string {
  return addr.length <= lead + tail ? addr : `${addr.slice(0, lead)}…${addr.slice(-tail)}`
}

export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number) {
  let t: ReturnType<typeof setTimeout> | undefined
  return (...a: A) => {
    clearTimeout(t)
    t = setTimeout(() => fn(...a), ms)
  }
}

export function isExpired(fetchedAt: number, ttl: number): boolean {
  return Date.now() - fetchedAt > ttl
}

export function formatPrice(price: number): string {
  if (price >= 1000) return `$${price.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
  if (price >= 1) return `$${price.toFixed(2)}`
  if (price >= 0.0001) return `$${price.toPrecision(4)}`
  // subscript zero notation: $0.0₅46205
  const str = price.toFixed(20)
  const afterDot = str.split('.')[1] ?? ''
  const zeros = afterDot.match(/^0+/)?.[0].length ?? 0
  if (zeros >= 3) {
    const sub = '₀₁₂₃₄₅₆₇₈₉'[zeros] ?? zeros.toString()
    const sig = afterDot.slice(zeros, zeros + 5)
    return `$0.0${sub}${sig}`
  }
  return `$${price.toFixed(8)}`
}

export function formatCompact(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`
  return `$${n.toFixed(2)}`
}
