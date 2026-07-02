import { invoke } from '@tauri-apps/api/core'
import { useWalletStore } from '../store/wallet'

export function useWallet() {
  const address = useWalletStore((s) => s.address)
  const setAddress = useWalletStore((s) => s.setAddress)
  const setStage = useWalletStore((s) => s.setStage)
  const setWallets = useWalletStore((s) => s.setWallets)

  async function logout() {
    await invoke('stop_detector')
    await invoke('lock_wallet')
    setAddress(null)
    setWallets([], null)
    setStage('locked')
  }

  return { address, logout }
}
