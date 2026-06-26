import { invoke } from '@tauri-apps/api/core'
import type { DetectedToken, TxResult } from '../types'

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)!
  return bytes
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
  return btoa(binary)
}

interface QuoteResult {
  serialized_tx: string
  out_amount: number
  out_amount_ui: number
  price_impact_pct: number
  provider: string
}

interface ExecuteBuyArgs {
  userPublicKey: string
  /** Signs the raw transaction bytes (wallet/Privy specifics live at the call site). */
  sign: (txBytes: Uint8Array) => Promise<Uint8Array>
  token: DetectedToken
  amountSol: number
  slippageBps: number
}

export interface BuyOutcome {
  result: TxResult
  outAmountUi: number
}

/**
 * One-shot buy: quote → sign → send. Privy-agnostic — the caller supplies a
 * `sign` callback. Shared by the dashboard TradePanel flow and the capybara pet
 * bridge (which fires this end-to-end on behalf of the overlay window).
 */
export async function executeBuy({
  userPublicKey,
  sign,
  token,
  amountSol,
  slippageBps,
}: ExecuteBuyArgs): Promise<BuyOutcome> {
  const amountLamports = Math.floor(amountSol * 1e9)

  const quote = await invoke<QuoteResult>('build_swap_transaction', {
    params: {
      output_mint: token.mint,
      amount_lamports: amountLamports,
      slippage_bps: slippageBps,
      user_public_key: userPublicKey,
      output_decimals: token.decimals,
    },
  })

  const signed = await sign(base64ToBytes(quote.serialized_tx))

  const result = await invoke<TxResult>('send_transaction', {
    signedTxBase64: bytesToBase64(signed),
  })

  return { result, outAmountUi: quote.out_amount_ui }
}
