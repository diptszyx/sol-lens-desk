import { create } from 'zustand'

export type WalletStage = 'loading' | 'no-wallet' | 'locked' | 'ready'

export interface WalletInfo {
  address: string
  label: string
}

interface WalletStore {
  address: string | null
  stage: WalletStage
  wallets: WalletInfo[]
  activeAddress: string | null
  setAddress: (addr: string | null) => void
  setStage: (stage: WalletStage) => void
  setWallets: (wallets: WalletInfo[], active: string | null) => void
  setActiveAddress: (addr: string) => void
  addWallet: (w: WalletInfo) => void
  removeWallet: (addr: string) => void
  renameWallet: (addr: string, label: string) => void
}

export const useWalletStore = create<WalletStore>((set) => ({
  address: null,
  stage: 'loading',
  wallets: [],
  activeAddress: null,
  setAddress: (addr) => set({ address: addr, activeAddress: addr }),
  setStage: (stage) => set({ stage }),
  setWallets: (wallets, active) => set({ wallets, activeAddress: active, address: active }),
  setActiveAddress: (addr) => set({ activeAddress: addr, address: addr }),
  addWallet: (w) => set((s) => ({ wallets: [...s.wallets, w] })),
  removeWallet: (addr) => set((s) => ({
    wallets: s.wallets.filter((w) => w.address !== addr),
  })),
  renameWallet: (addr, label) => set((s) => ({
    wallets: s.wallets.map((w) => w.address === addr ? { ...w, label } : w),
  })),
}))
