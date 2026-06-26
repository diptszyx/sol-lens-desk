import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useWalletStore } from '../../store/wallet'
import { WalletSetup } from './WalletSetup'
import { WalletUnlock } from './WalletUnlock'

type Stage = 'loading' | 'no-wallet' | 'locked' | 'ready'

interface WalletStatus {
  has_wallet: boolean
  is_unlocked: boolean
  address: string | null
}

export function WalletGate({ children }: { children: React.ReactNode }) {
  const setAddress = useWalletStore((s) => s.setAddress)
  const [stage, setStage] = useState<Stage>('loading')

  useEffect(() => {
    invoke<WalletStatus>('get_wallet_status').then((s) => {
      if (s.is_unlocked && s.address) {
        setAddress(s.address)
        setStage('ready')
      } else if (s.has_wallet) {
        setStage('locked')
      } else {
        setStage('no-wallet')
      }
    })
  }, [setAddress])

  function onWalletReady(address: string) {
    setAddress(address)
    setStage('ready')
  }

  if (stage === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--bg-deep)]">
        <div className="w-6 h-6 rounded-full border-2 border-[var(--border)] border-t-[var(--accent)] animate-spin" />
      </div>
    )
  }
  if (stage === 'no-wallet') return <WalletSetup onSuccess={onWalletReady} />
  if (stage === 'locked') return <WalletUnlock onSuccess={onWalletReady} />
  return <>{children}</>
}
