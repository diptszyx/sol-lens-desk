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
  mint_authority_revoked: boolean
  freeze_authority_revoked: boolean
  score: number
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
}

/** Default stop-loss as a positive percent below entry. */
export const DEFAULT_SL_PCT = 50

export interface SwapParams {
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

export const DEFAULT_FILTER: FilterConfig = {
  maxAgeSec: null,
  minLiquiditySol: null,
  hideUnnamed: true,
  search: '',
  minScoreThreshold: 55,
}

export const SCORE_PRESETS = {
  degen: { label: 'Degen', threshold: 30 },
  balanced: { label: 'Balanced', threshold: 55 },
  safe: { label: 'Safe', threshold: 75 },
} as const
