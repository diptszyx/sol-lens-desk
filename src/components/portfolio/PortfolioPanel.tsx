import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { emit } from '@tauri-apps/api/event'
import { usePortfolioStore } from '../../store/portfolio'
import { useWalletStore } from '../../store/wallet'

// Stop-loss presets as positive percent below entry (50 = sell at -50%).
const SL_OPTIONS = [20, 30, 50, 70]

export function PortfolioPanel() {
  const positions = usePortfolioStore((s) => s.positions)
  const globalStopLossPct = usePortfolioStore((s) => s.globalStopLossPct)
  const setGlobalStopLoss = usePortfolioStore((s) => s.setGlobalStopLoss)
  const setPositionStopLoss = usePortfolioStore((s) => s.setPositionStopLoss)
  const address = useWalletStore((s) => s.address)
  const [selling, setSelling] = useState<string | null>(null)
  const [editingSl, setEditingSl] = useState<string | null>(null)

  if (positions.length === 0) return null

  async function handleSell(mint: string, amountTokens: number, decimals: number) {
    if (!address || selling) return
    setSelling(mint)
    try {
      const amountRaw = Math.floor(amountTokens * Math.pow(10, decimals))
      const quote = await invoke<{ serialized_tx: string; out_amount_ui: number }>('build_sell_transaction', {
        params: {
          input_mint: mint,
          amount_tokens: amountRaw,
          slippage_bps: 100,
          user_public_key: address,
          input_decimals: decimals,
        },
      })

      const signedTxBase64 = await invoke<string>('sign_transaction', {
        txBase64: quote.serialized_tx,
      })

      const txResult = await invoke<{ signature: string; status: string }>('send_sell_transaction', {
        signedTxBase64,
      })

      if (txResult.status === 'confirmed') {
        const pos = usePortfolioStore.getState().positions.find((p) => p.mint === mint)

        invoke('log_trade', {
          mint,
          symbol: pos?.symbol ?? mint.slice(0, 6),
          side: 'sell',
          amountSol: quote.out_amount_ui,
          amountTokens,
          priceUsd: pos?.current_price_usd ?? null,
          txSignature: txResult.signature,
          status: 'confirmed',
          createdAt: Date.now(),
        }).catch(console.error)

        invoke('stop_price_tracking', { mint }).catch(console.error)

        emit('position_closed', {
          mint,
          close_reason: 'manual',
          exit_price_usd: pos?.current_price_usd ?? 0,
          realized_pnl_pct: pos?.pnl_pct ?? 0,
        })
      }
    } catch (err) {
      console.error('Sell failed:', err)
    } finally {
      setSelling(null)
    }
  }

  // Push the edited stop-loss to the backend price tracker so auto-sell uses it.
  function confirmSl(mint: string) {
    setEditingSl(null)
    const pos = usePortfolioStore.getState().positions.find((p) => p.mint === mint)
    if (!pos) return
    invoke('start_price_tracking', {
      mint,
      entryPriceUsd: pos.entry_price_usd,
      stopLossPct: pos.stop_loss_pct,
    }).catch(console.error)
  }

  return (
    <div className="border-t border-[var(--border)] bg-[var(--bg-base)]">
      <div className="px-4 py-2 border-b border-[var(--border)] flex items-center justify-between">
        <span className="text-xs font-semibold text-[var(--text-2)] uppercase tracking-wide">
          Portfolio ({positions.length})
        </span>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-[var(--text-3)]">Default SL:</span>
          <select
            value={globalStopLossPct}
            onChange={(e) => setGlobalStopLoss(Number(e.target.value))}
            className="text-[10px] bg-[var(--bg-deep)] border border-[var(--border)] rounded px-1.5 py-0.5 text-[var(--text-1)] outline-none focus:border-[var(--accent)]"
          >
            {SL_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>-{opt}%</option>
            ))}
          </select>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[var(--text-3)] border-b border-[var(--border)]">
              <th className="text-left px-3 py-2 font-medium">Token</th>
              <th className="text-right px-3 py-2 font-medium">Entry</th>
              <th className="text-right px-3 py-2 font-medium">Current</th>
              <th className="text-right px-3 py-2 font-medium">PnL</th>
              <th className="text-right px-3 py-2 font-medium">SL</th>
              <th className="text-right px-3 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {positions.map((p) => {
              const pnlColor =
                p.pnl_pct == null
                  ? 'text-[var(--text-3)]'
                  : p.pnl_pct >= 0
                    ? 'text-green-400'
                    : 'text-red-400'

              const slPct = p.stop_loss_pct ?? globalStopLossPct

              return (
                <tr
                  key={p.mint}
                  className="border-b border-[var(--border)]/50 hover:bg-[var(--bg-surface)]"
                >
                  <td className="px-3 py-2 font-mono text-[var(--text-1)]">
                    ${p.symbol}
                  </td>
                  <td className="px-3 py-2 text-right text-[var(--text-3)] font-mono">
                    {p.entry_price_usd < 0.0001
                      ? p.entry_price_usd.toExponential(2)
                      : p.entry_price_usd.toFixed(p.entry_price_usd >= 1 ? 4 : 8)}
                  </td>
                  <td className="px-3 py-2 text-right text-[var(--text-2)] font-mono">
                    {p.current_price_usd != null
                      ? p.current_price_usd < 0.0001
                        ? p.current_price_usd.toExponential(2)
                        : p.current_price_usd.toFixed(p.current_price_usd >= 1 ? 4 : 8)
                      : '—'}
                  </td>
                  <td className={`px-3 py-2 text-right font-semibold ${pnlColor}`}>
                    {p.pnl_pct != null
                      ? `${p.pnl_pct >= 0 ? '+' : ''}${p.pnl_pct.toFixed(1)}%`
                      : '—'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {editingSl === p.mint ? (
                      <input
                        type="number"
                        value={slPct}
                        onChange={(e) => setPositionStopLoss(p.mint, Number(e.target.value))}
                        onBlur={() => confirmSl(p.mint)}
                        onKeyDown={(e) => e.key === 'Enter' && confirmSl(p.mint)}
                        autoFocus
                        className="w-12 text-right bg-[var(--bg-deep)] border border-[var(--accent)] rounded px-1 py-0.5 text-[var(--text-1)] outline-none text-xs"
                      />
                    ) : (
                      <button
                        onClick={() => setEditingSl(p.mint)}
                        className="text-[var(--text-3)] hover:text-[var(--text-1)] cursor-pointer"
                      >
                        -{slPct}% ✏
                      </button>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => handleSell(p.mint, p.amount_tokens, p.decimals)}
                      disabled={selling === p.mint || !address}
                      className="text-xs px-2.5 py-1 rounded-md font-bold transition-colors disabled:opacity-50
                        bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20"
                    >
                      {selling === p.mint ? 'Selling…' : 'SELL'}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
