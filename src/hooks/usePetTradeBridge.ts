import { useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen, emitTo } from '@tauri-apps/api/event'
import { useWalletStore } from '../store/wallet'
import { usePortfolioStore } from '../store/portfolio'
import {
  PET_BUY_REQUEST,
  PET_BUY_RESULT,
  type PetBuyRequest,
  type PetBuyResult,
} from '../types'

export function usePetTradeBridge() {
  const address = useWalletStore((s) => s.address)
  const addPosition = usePortfolioStore((s) => s.addPosition)

  useEffect(() => {
    let unlisten: (() => void) | null = null

    listen<PetBuyRequest>(PET_BUY_REQUEST, async (e) => {
      const { token, amountSol, slippageBps } = e.payload

      const reply = (result: PetBuyResult) => {
        emitTo('pet', PET_BUY_RESULT, result).catch(() => {})
      }

      if (!address) {
        reply({ mint: token.mint, status: 'failed', signature: null, error: 'Wallet locked' })
        return
      }

      try {
        const amountLamports = Math.floor(amountSol * 1e9)

        const quote = await invoke<{ serialized_tx: string; out_amount_ui: number }>('build_swap_transaction', {
          params: {
            output_mint: token.mint,
            amount_lamports: amountLamports,
            slippage_bps: slippageBps,
            user_public_key: address,
            output_decimals: token.decimals,
          },
        })

        const signedTxBase64 = await invoke<string>('sign_transaction', {
          txBase64: quote.serialized_tx,
        })

        const txResult = await invoke<{ signature: string; status: string; error: string | null }>('send_transaction', {
          signedTxBase64,
        })

        reply({
          mint: token.mint,
          status: txResult.status as 'confirmed' | 'failed',
          signature: txResult.signature ?? null,
          error: txResult.error,
        })

        if (txResult.status === 'confirmed' && token.price_usd != null) {
          addPosition({
            mint: token.mint,
            symbol: token.symbol ?? token.mint.slice(0, 6),
            entry_price_usd: token.price_usd,
            amount_tokens: quote.out_amount_ui,
            amount_sol_spent: amountSol,
            current_price_usd: token.price_usd,
            pnl_pct: null,
            opened_at: Date.now(),
            tx_signature: txResult.signature,
          })
        }
      } catch (err) {
        reply({ mint: token.mint, status: 'failed', signature: null, error: String(err) })
      }
    }).then((fn) => { unlisten = fn })

    return () => { unlisten?.() }
  }, [address, addPosition])
}
