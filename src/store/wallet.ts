import { create } from 'zustand'

export type WalletStage = 'loading' | 'no-wallet' | 'locked' | 'ready'

interface WalletStore {
  address: string | null
  stage: WalletStage
  setAddress: (addr: string | null) => void
  setStage: (stage: WalletStage) => void
}

export const useWalletStore = create<WalletStore>((set) => ({
  address: null,
  stage: 'loading',
  setAddress: (addr) => set({ address: addr }),
  setStage: (stage) => set({ stage }),
}))
