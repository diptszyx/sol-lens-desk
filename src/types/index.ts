export interface ScoreBreakdown {
  dev_hold_safety: number
  bonding_curve_signal: number
  dev_buy_signal: number
  socials_signal: number
}

export interface DetectedToken {
  mint: string
  symbol: string | null
  name: string | null
  decimals: number
  price_usd: number | null
  liquidity_sol: number
  market_cap_usd: number | null
  volume_24h: number | null
  holder_count: number | null
  age_seconds: number
  source: string
  detected_at: number
  dev_address: string | null
  dev_hold_pct: number | null
  bonding_curve_pct: number | null
  dev_buy_sol: number | null
  has_socials: boolean | null
  twitter_url: string | null
  telegram_url: string | null
  website_url: string | null
  mint_authority_revoked: boolean
  freeze_authority_revoked: boolean
  score: number
  score_breakdown: ScoreBreakdown
}

export interface Position {
  mint: string
  symbol: string
  decimals: number
  entry_price_usd: number
  amount_tokens: number
  amount_sol_spent: number
  current_price_usd: number | null
  pnl_pct: number | null
  opened_at: number
  tx_signature: string
  /** Positive percent below entry that triggers stop-loss. e.g. 50 = sell at -50%. */
  stop_loss_pct: number
  /** false after restore — PnL stays 0% until first price update arrives. */
  priceLoaded: boolean
}

/** Default stop-loss as a positive percent below entry. */
export const DEFAULT_SL_PCT = 50

export interface SwapParams {
  input_mint: string
  output_mint: string
  amount_lamports: number
  slippage_bps: number
  user_public_key: string
  output_decimals: number
}

export interface TxResult {
  signature: string
  status: 'confirmed' | 'failed'
  error: string | null
}

export interface PetBuyRequest {
  token: DetectedToken
  amountSol: number
  slippageBps: number
}

export interface PetBuyResult {
  mint: string
  status: 'confirmed' | 'failed'
  signature: string | null
  error: string | null
}

export const PET_BUY_REQUEST = 'pet_buy_request'
export const PET_BUY_RESULT = 'pet_buy_result'

export interface FilterConfig {
  maxAgeSec: number | null
  minLiquiditySol: number | null
  hideUnnamed: boolean
  search: string
  minScoreThreshold: number
}

export const MAX_AGE_SEC = 600 // 10 min = watch_list TTL; stale beyond this

export const DEFAULT_FILTER: FilterConfig = {
  maxAgeSec: 120,
  minLiquiditySol: 3,
  hideUnnamed: true,
  search: '',
  minScoreThreshold: 60,
}

export const SCORE_PRESETS = {
  degen: { label: 'Degen', threshold: 30 },
  balanced: { label: 'Balanced', threshold: 60 },
  safe: { label: 'Safe', threshold: 80 },
} as const
