import { invoke } from '@tauri-apps/api/core'
import { useWalletStore } from '../store/wallet'

export function useWallet() {
  const { address, setAddress } = useWalletStore()

  async function logout() {
    await invoke('lock_wallet')
    setAddress(null)
  }

  return { address, logout }
}

export async function refreshWalletAddress(setAddress: (a: string | null) => void) {
  const status = await invoke<{ address: string | null }>('get_wallet_status')
  setAddress(status.address)
}
