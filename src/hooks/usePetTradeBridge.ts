import { useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen, emitTo, emit } from '@tauri-apps/api/event'
import { useWalletStore } from '../store/wallet'
import {
  PET_BUY_REQUEST,
  PET_BUY_RESULT,
  type PetBuyRequest,
  type PetBuyResult,
} from '../types'

// Pet quick-buy pays with SOL only — mirrors TradePanel.tsx (bonding curves detected
// fresh are quote_mint=SOL in practice).
const SOL_MINT = 'So11111111111111111111111111111111111111112'

export function usePetTradeBridge() {
  const address = useWalletStore((s) => s.address)

  useEffect(() => {
    let unlisten: (() => void) | null = null
    let cancelled = false

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
            input_mint: SOL_MINT,
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

        if (txResult.status === 'confirmed' && quote.out_amount_ui > 0) {
          // BuyV2 locks in an exact token amount and lets the SOL side float with
          // curve movement between quote and confirmation — amountSol (requested)
          // isn't what actually left the wallet. Read the confirmed tx for the real figure.
          const realAmountSol = await invoke<number>('get_actual_swap_sol', {
            mint: token.mint, signature: txResult.signature,
          }).catch(() => amountSol)

          const solPriceUsd = await invoke<number | null>('get_sol_price_usd').catch(() => null)
          const entryPriceUsd = solPriceUsd != null ? (realAmountSol * solPriceUsd) / quote.out_amount_ui : token.price_usd

          if (entryPriceUsd != null) {
            // Position creation AND price-tracking subscription are both owned by the
            // `buy_confirmed` listener in the store, so the tracker's entry always
            // matches the (possibly DCA-blended) position. Don't subscribe here.
            emit('buy_confirmed', {
              mint: token.mint,
              symbol: token.symbol ?? token.mint.slice(0, 6),
              decimals: token.decimals,
              amount_sol: realAmountSol,
              amount_tokens: quote.out_amount_ui,
              entry_price_usd: entryPriceUsd,
              tx_signature: txResult.signature,
            })
          }
        }
      } catch (err) {
        reply({ mint: token.mint, status: 'failed', signature: null, error: String(err) })
      }
    }).then((fn) => {
      // StrictMode (dev) mounts/cleans up/remounts synchronously — if cleanup already ran
      // by the time this promise resolves, unlisten immediately instead of leaking a
      // second live listener (which would double-fire every buy request).
      if (cancelled) {
        fn()
      } else {
        unlisten = fn
      }
    })

    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [address])
}
