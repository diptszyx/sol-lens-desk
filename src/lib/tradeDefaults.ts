const SETTINGS_KEY = 'trade_defaults'

export interface TradeDefaults {
  defaultAmount: string
  defaultSlippage: string
}

const FALLBACK: TradeDefaults = { defaultAmount: '0.1', defaultSlippage: '100' }

export function loadTradeDefaults(): TradeDefaults {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      return {
        defaultAmount: parsed.defaultAmount ?? FALLBACK.defaultAmount,
        defaultSlippage: parsed.defaultSlippage ?? FALLBACK.defaultSlippage,
      }
    }
  } catch { /* ignore */ }
  return FALLBACK
}

export function saveTradeDefaults(v: TradeDefaults) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(v))
}
