import { invoke } from '@tauri-apps/api/core'
import { useWalletStore } from '../store/wallet'

export function useWallet() {
  const address = useWalletStore((s) => s.address)
  const setAddress = useWalletStore((s) => s.setAddress)
  const setStage = useWalletStore((s) => s.setStage)

  async function logout() {
    await invoke('lock_wallet')
    setAddress(null)
    setStage('locked')
  }

  return { address, logout }
}
