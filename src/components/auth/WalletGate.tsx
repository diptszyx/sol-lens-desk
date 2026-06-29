import { useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useWalletStore } from '../../store/wallet'
import { WalletSetup } from './WalletSetup'
import { WalletUnlock } from './WalletUnlock'
import { LoadingScreen } from './LoadingScreen'

interface WalletStatus {
  has_wallet: boolean
  is_unlocked: boolean
  address: string | null
}

export function WalletGate({ children }: { children: React.ReactNode }) {
  const setAddress = useWalletStore((s) => s.setAddress)
  const stage = useWalletStore((s) => s.stage)
  const setStage = useWalletStore((s) => s.setStage)

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
  }, [setAddress, setStage])

  function onWalletReady(address: string) {
    setAddress(address)
    setStage('ready')
  }

  if (stage === 'loading') return <LoadingScreen />
  if (stage === 'no-wallet') return <WalletSetup onSuccess={onWalletReady} />
  if (stage === 'locked') return <WalletUnlock onSuccess={onWalletReady} onReset={() => setStage('no-wallet')} />
  return <>{children}</>
}
