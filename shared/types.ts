export interface TokenMeta {
  symbol: string
  name: string
  mint: string
  decimals: number
  logoURI?: string
  priceUsd?: number
  priceChange24h?: number
  liquidityUsd?: number
  mcap?: number
  volume24h?: number
  holderCount?: number
  fdv?: number
  createdAt?: number
  source: string
  fetchedAt: number
}

export interface PriceHistory {
  prices: number[]
  timestamps: number[]
}

/** A token the user spends when buying (the input/"pay" side of a swap). */
export interface PayToken {
  symbol: string
  name: string
  mint: string
  decimals: number
}

/** A token the connected wallet holds, used to populate the pay-token picker. */
export interface HoldingToken extends PayToken {
  /** Balance in UI units (0 for default tokens the wallet doesn't hold). */
  uiAmount: number
  valueUsd?: number
  logoURI?: string
}

/** A Solana wallet detected in the page via Wallet Standard. */
export interface WalletInfo {
  name: string
  icon: string
}

/** Connected wallet state persisted in chrome.storage.local. */
export interface ConnectedWallet {
  name: string
  icon: string
  /** base58 public key (account address) — never a private key. */
  address: string
  connectedAt: number
}

/** A completed swap recorded in history. */
export interface SwapRecord {
  signature: string
  inputSymbol: string
  inputAmount: string
  outputSymbol: string
  outputAmount: string
  timestamp: number
  status: 'success' | 'pending' | 'failed'
  inputUsdValue?: number
  outputUsdValue?: number
  inputLogoURI?: string
  outputLogoURI?: string
}

/** Lightweight quote sent to the content script for display. */
export interface SwapQuoteView {
  quoteId: string
  provider: string
  outAmount: string
  priceImpactPct?: number
  routeLabel?: string
}

export type Timeframe = '15m' | '1h' | '4h' | '1d'

export type Message =
  | { type: 'RESOLVE_SYMBOL'; symbol: string }
  | { type: 'GET_PRICE_HISTORY'; mint: string; symbol: string; timeframe?: Timeframe }
  | { type: 'GET_TAB_TOKENS' }
  | { type: 'LIST_WALLETS'; tabId: number }
  | { type: 'CONNECT_WALLET'; wallet: string; tabId: number }
  | { type: 'DISCONNECT_WALLET' }
  | { type: 'GET_WALLET' }
  | { type: 'GET_WALLET_TOKENS'; address: string }
  | { type: 'GET_SWAP_QUOTE'; inputMint: string; outputMint: string; amountRaw: string; slippageBps: number }
  | { type: 'EXECUTE_SWAP'; quoteId: string; tabId: number; inputSymbol: string; inputAmount: string; outputSymbol: string; outputDecimals: number }
  | { type: 'ENSURE_TAB_CONNECTED' }
  | { type: 'DETECT_AND_CONNECT'; walletName?: string; tabId?: number }
  | { type: 'GET_SWAP_HISTORY' }

export type MessageResponse =
  | { ok: true; token: TokenMeta | null }
  | { ok: true; tokens: TokenMeta[] }
  | { ok: true; prices: number[]; timestamps: number[] }
  | { ok: true; wallets: WalletInfo[] }
  | { ok: true; wallet: ConnectedWallet | null }
  | { ok: true; tokens: HoldingToken[] }
  | { ok: true; quote: SwapQuoteView }
  | { ok: true; signature: string }
  | { ok: true; records: SwapRecord[] }
  | { ok: false; error: string }
