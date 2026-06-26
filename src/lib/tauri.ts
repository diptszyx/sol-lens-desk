import { invoke } from '@tauri-apps/api/core'
import type { SwapParams, TxResult, DetectedToken } from '../types'

export async function getNewTokens(): Promise<DetectedToken[]> {
  return invoke('get_new_tokens')
}

export async function getTokenDetail(mint: string): Promise<DetectedToken> {
  return invoke('get_token_detail', { mint })
}

export async function buildSwapTransaction(params: SwapParams): Promise<{
  serialized_tx: string
  out_amount: number
  price_impact_pct: number
}> {
  return invoke('build_swap_transaction', { params })
}

export async function sendTransaction(signedTxBase64: string): Promise<TxResult> {
  return invoke('send_transaction', { signedTxBase64 })
}
