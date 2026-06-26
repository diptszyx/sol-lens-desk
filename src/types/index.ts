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
  // Meme-trade signals (pump.fun)
  dev_address: string | null
  dev_hold_pct: number | null
  bonding_curve_pct: number | null
  dev_buy_sol: number | null
  has_socials: boolean | null
}

export interface Position {
  mint: string
  symbol: string
  entry_price_usd: number
  amount_tokens: number
  amount_sol_spent: number
  current_price_usd: number | null
  pnl_pct: number | null
  opened_at: number
  tx_signature: string
}

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

/** Pet overlay → dashboard: request a buy executed by the wallet-holding window. */
export interface PetBuyRequest {
  token: DetectedToken
  amountSol: number
  slippageBps: number
}

/** Dashboard → pet overlay: result of a requested buy. */
export interface PetBuyResult {
  mint: string
  status: 'confirmed' | 'failed'
  signature: string | null
  error: string | null
}

export const PET_BUY_REQUEST = 'pet_buy_request'
export const PET_BUY_RESULT = 'pet_buy_result'

/** Per-user feed filter. `null` threshold = no constraint. Persisted to disk. */
export interface FilterConfig {
  maxAgeSec: number | null
  maxDevHoldPct: number | null
  minDevBuySol: number | null
  maxMcapUsd: number | null
  minBondingCurvePct: number | null
  minLiquiditySol: number | null
  requireSocials: boolean
  hideUnnamed: boolean
  sources: string[] | null
  search: string
}

export const DEFAULT_FILTER: FilterConfig = {
  maxAgeSec: null,
  maxDevHoldPct: null,
  minDevBuySol: null,
  maxMcapUsd: null,
  minBondingCurvePct: null,
  minLiquiditySol: null,
  requireSocials: false,
  hideUnnamed: true, // hide "?" / unnamed spam by default
  sources: null,
  search: '',
}

/** Built-in "degen sniper" preset — aggressive early-entry filter. */
export const SNIPER_PRESET: FilterConfig = {
  maxAgeSec: 120,
  maxDevHoldPct: 15,
  minDevBuySol: 0.5,
  maxMcapUsd: 40000,
  minBondingCurvePct: null,
  minLiquiditySol: 3,
  requireSocials: true,
  hideUnnamed: true,
  sources: ['pump_fun'],
  search: '',
}
