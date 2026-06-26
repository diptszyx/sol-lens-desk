export const SYMBOL_RE = /\$([A-Za-z]{2,10})\b(?!\d)/g

/** SOL mint — required for transaction fees; used as default pay token. */
export const SOL_MINT = 'So11111111111111111111111111111111111111112'

export const PAY_TOKEN_KEY = 'sol_lens_pay_token'
export const SLIPPAGE_KEY = 'sol_lens_slippage_bps'

export const SWAP_SLIPPAGE_BPS = 50

export const SWAP_QUOTE_TTL_MS = 30_000

export const QUOTE_DEBOUNCE_MS = 600

export const JUPITER_SEARCH_URL = 'https://api.jup.ag/tokens/v2/search'
export const BIRDEYE_OHLCV_URL = 'https://public-api.birdeye.so/defi/ohlcv'

export const CACHE_TTL = {
  token: 5 * 60_000,
  negative: 30 * 60_000,
  priceHistory: 10 * 60_000,
} as const

export const SCAN_DEBOUNCE_MS = 200

export const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'CODE', 'PRE'])

export const SYMBOL_BLOCKLIST = new Set(['USD', 'EUR', 'GBP', 'JPY'])
