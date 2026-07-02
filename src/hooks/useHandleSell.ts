import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { usePortfolioStore } from '../store/portfolio'
import { useWalletStore } from '../store/wallet'

const DEFAULT_SELL_SLIPPAGE_BPS = 300
const FORCE_SELL_SLIPPAGE_BPS = 9900

// Maps raw invoke() error strings to messages a memecoin trader can act on —
// silently logging to console.error left users staring at a button that
// reverted with no explanation of what happened or what to do next.
function describeSellError(err: unknown): string {
  const raw = String(err)
  if (raw.includes('0x1773') || raw.includes('custom program error: 6003')) {
    return 'Giá trượt vượt mức cho phép (curve biến động mạnh). Bấm "Force Sell" để chấp nhận giá hiện tại và thoát ngay.'
  }
  if (raw.toLowerCase().includes('bonding curve complete')) {
    return 'Token đã graduate sang PumpSwap — chưa hỗ trợ bán trực tiếp trên đó.'
  }
  return `Sell thất bại: ${raw}`
}

export function useHandleSell() {
  const address = useWalletStore((s) => s.address)
  const [selling, setSelling] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})

  async function handleSell(mint: string, amountTokens: number, decimals: number, opts?: { force?: boolean }) {
    if (!address || selling) return
    setSelling(mint)
    setErrors((prev) => {
      if (!(mint in prev)) return prev
      const { [mint]: _removed, ...rest } = prev
      return rest
    })
    try {
      const amountRaw = Math.floor(amountTokens * Math.pow(10, decimals))
      const slippageBps = opts?.force ? FORCE_SELL_SLIPPAGE_BPS : DEFAULT_SELL_SLIPPAGE_BPS
      const quote = await invoke<{ serialized_tx: string; out_amount_ui: number }>(
        'build_sell_transaction',
        { params: { input_mint: mint, amount_tokens: amountRaw, slippage_bps: slippageBps, user_public_key: address, input_decimals: decimals } }
      )
      const signedTxBase64 = await invoke<string>('sign_transaction', { txBase64: quote.serialized_tx })
      const txResult = await invoke<{ signature: string; status: string }>('send_sell_transaction', { signedTxBase64 })

      if (txResult.status === 'confirmed') {
        const pos = usePortfolioStore.getState().positions.find((p) => p.mint === mint)
        // SellV2 sells an exact token amount and lets the SOL side float with curve
        // movement between quote and confirmation — quote.out_amount_ui is only the
        // build-time estimate. Read the confirmed tx for what was actually received.
        const realAmountSol = await invoke<number>('get_actual_swap_sol', { mint, signature: txResult.signature })
          .catch(() => quote.out_amount_ui)

        invoke('log_trade', {
          mint, symbol: pos?.symbol ?? mint.slice(0, 6), side: 'sell',
          amountSol: realAmountSol, amountTokens, priceUsd: pos?.current_price_usd ?? null,
          txSignature: txResult.signature, status: 'confirmed', createdAt: Date.now(),
        }).catch(console.error)
        invoke('stop_price_tracking', { mint }).catch(console.error)
        const { emit } = await import('@tauri-apps/api/event')
        emit('position_closed', {
          mint, close_reason: 'manual',
          exit_price_usd: pos?.current_price_usd ?? 0,
          realized_pnl_pct: pos?.pnl_pct ?? 0,
          amount_sol_received: realAmountSol,
        })
      }
    } catch (err) {
      console.error('Sell failed:', err)
      setErrors((prev) => ({ ...prev, [mint]: describeSellError(err) }))
    } finally {
      setSelling(null)
    }
  }

  return { handleSell, selling, errors }
}
