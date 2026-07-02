import { useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useWalletStore } from '../../store/wallet'
import type { WalletInfo } from '../../store/wallet'
import { WalletSetup } from './WalletSetup'
import { WalletUnlock } from './WalletUnlock'
import { LoadingScreen } from './LoadingScreen'

interface WalletStatus {
  has_vault: boolean
  is_unlocked: boolean
  active_address: string | null
  wallets: WalletInfo[]
}

export function WalletGate({ children }: { children: React.ReactNode }) {
  const setAddress = useWalletStore((s) => s.setAddress)
  const stage = useWalletStore((s) => s.stage)
  const setStage = useWalletStore((s) => s.setStage)
  const setWallets = useWalletStore((s) => s.setWallets)

  useEffect(() => {
    invoke<WalletStatus>('get_wallet_status').then((s) => {
      if (s.is_unlocked && s.active_address) {
        setWallets(s.wallets, s.active_address)
        setStage('ready')
      } else if (s.has_vault) {
        setStage('locked')
      } else {
        setStage('no-wallet')
      }
    })
  }, [setAddress, setStage, setWallets])

  // Only run the token detector once a wallet is unlocked.
  useEffect(() => {
    if (stage === 'ready') {
      invoke('start_detector')
    }
  }, [stage])

  // Re-lock the UI after the inactivity timeout. Manual signing no longer clears
  // keys on timeout (the background stop-loss tracker keeps its own signing
  // authority), so the UI must poll and re-prompt for the app password itself.
  // The tracker keeps running while this screen is shown.
  useEffect(() => {
    if (stage !== 'ready') return
    const id = setInterval(() => {
      invoke<WalletStatus>('get_wallet_status').then((s) => {
        if (!s.is_unlocked) setStage('locked')
      }).catch(() => {})
    }, 30000)
    return () => clearInterval(id)
  }, [stage, setStage])

  function onWalletReady(address: string, wallets?: WalletInfo[]) {
    if (wallets && wallets.length > 0) {
      setWallets(wallets, address)
    } else {
      setAddress(address)
    }
    setStage('ready')
  }

  if (stage === 'loading') return <LoadingScreen />
  if (stage === 'no-wallet') return <WalletSetup onSuccess={onWalletReady} />
  if (stage === 'locked') return <WalletUnlock onSuccess={onWalletReady} />
  return <>{children}</>
}
