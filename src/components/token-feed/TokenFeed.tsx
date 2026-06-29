import { useEffect, useMemo, useState } from 'react'
import { useTokenFeed } from '../../hooks/useTokenFeed'
import { useTokenFeedStore } from '../../store/tokenFeed'
import { useFilterStore } from '../../store/filter'
import { matchesFilter } from '../../lib/filter'
import { TokenRow } from './TokenRow'
import { FilterPanel } from '../filter/FilterPanel'

export function TokenFeed() {
  useTokenFeed()
  const { tokens, selected, selectToken } = useTokenFeedStore()
  const filter = useFilterStore((s) => s.filter)
  const hydrate = useFilterStore((s) => s.hydrate)

  const [showFilter, setShowFilter] = useState(false)

  useEffect(() => { void hydrate() }, [hydrate])

  const filtered = useMemo(
    () => tokens.filter((t) => matchesFilter(t, filter)),
    [tokens, filter],
  )

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Count bar */}
      <div className="px-4 py-2 border-b border-[var(--border)] bg-[var(--bg-base)] flex-shrink-0 flex items-center justify-between">
        <span className="text-xs text-[var(--text-3)]">
          <span className="text-[var(--text-1)] font-bold tabular-nums">{filtered.length}</span>
          {' / '}
          <span className="tabular-nums">{tokens.length}</span>
          {' tokens'}
        </span>
        <button
          onClick={() => setShowFilter(!showFilter)}
          className={`text-xs px-2 py-0.5 rounded transition-colors ${
            showFilter
              ? 'text-[var(--accent)] bg-[var(--accent)]/10 border border-[var(--accent)]/30'
              : 'text-[var(--text-3)] hover:text-[var(--text-1)]'
          }`}
        >
          ⚙ Filters
        </button>
      </div>

      {showFilter && <FilterPanel onClose={() => setShowFilter(false)} />}

      {/* Feed */}
      <div className="flex-1 overflow-y-auto">
        {filtered.map((token) => (
          <TokenRow
            key={token.mint}
            token={token}
            onClick={() => selectToken(token.mint)}
            isSelected={selected?.mint === token.mint}
          />
        ))}

        {tokens.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-8">
            <div className="w-8 h-8 rounded-full border-2 border-[var(--border)] border-t-[var(--accent)] animate-spin" />
            <p className="text-sm font-medium text-[var(--text-2)]">Listening for new tokens…</p>
            <p className="text-xs text-[var(--text-3)]">pump.fun WebSocket connected</p>
          </div>
        )}

        {tokens.length > 0 && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center px-8">
            <span className="text-2xl">🚫</span>
            <p className="text-sm text-[var(--text-2)]">No tokens match your filters</p>
            <p className="text-xs text-[var(--text-3)]">{tokens.length} detected, all filtered out</p>
          </div>
        )}
      </div>
    </div>
  )
}
