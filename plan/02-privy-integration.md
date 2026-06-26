# P1 — Privy Integration

## Goal
User opens app → login screen → connect/create embedded wallet → wallet address visible → ready to trade.

## Privy Dashboard Setup (manual, one-time)

1. Create app at https://dashboard.privy.io
2. Add allowed origins:
   - `tauri://localhost`
   - `http://localhost:1420` (dev)
3. Enable **Embedded wallets**
4. Enable Solana network
5. Copy `App ID` → set as env var `VITE_PRIVY_APP_ID`

## Implementation

### PrivyProvider config (src/lib/privy.ts)

```typescript
import { PrivyProvider } from '@privy-io/react-auth'
import { toSolanaWalletConnectors } from '@privy-io/react-auth/solana'

export const privyConfig = {
  appId: import.meta.env.VITE_PRIVY_APP_ID as string,
  config: {
    appearance: {
      theme: 'dark' as const,
      accentColor: '#9945FF',  // Solana purple
    },
    embeddedWallets: {
      createOnLogin: 'users-without-wallets' as const,
      requireUserPasswordOnCreate: false,
    },
    supportedChains: [],  // Solana only — not EVM
  },
  solanaConnectors: toSolanaWalletConnectors(),
}
```

### App.tsx wrapper

```tsx
import { PrivyProvider } from '@privy-io/react-auth'
import { privyConfig } from './lib/privy'
import { Router } from './Router'

export default function App() {
  return (
    <PrivyProvider appId={privyConfig.appId} config={privyConfig.config}>
      <Router />
    </PrivyProvider>
  )
}
```

### Auth gate (src/components/auth/AuthGate.tsx)

```tsx
import { usePrivy } from '@privy-io/react-auth'

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { ready, authenticated, login } = usePrivy()

  if (!ready) return <LoadingScreen />
  if (!authenticated) return <LoginScreen onLogin={login} />
  return <>{children}</>
}
```

### Login screen (src/components/auth/LoginScreen.tsx)

```tsx
export function LoginScreen({ onLogin }: { onLogin: () => void }) {
  return (
    <div className="flex h-screen items-center justify-center bg-gray-950">
      <div className="flex flex-col items-center gap-6">
        <h1 className="text-2xl font-bold text-white">Sol Lens Desk</h1>
        <p className="text-gray-400">Detect & trade new Solana tokens</p>
        <button
          onClick={onLogin}
          className="rounded-lg bg-purple-600 px-8 py-3 text-white hover:bg-purple-500"
        >
          Connect Wallet
        </button>
      </div>
    </div>
  )
}
```

### Wallet hook (src/hooks/useWallet.ts)

```typescript
import { usePrivy, useSolanaWallets } from '@privy-io/react-auth'

export function useWallet() {
  const { user, logout } = usePrivy()
  const { wallets } = useSolanaWallets()

  const embeddedWallet = wallets.find(w => w.walletClientType === 'privy')

  return {
    address: embeddedWallet?.address ?? null,
    wallet: embeddedWallet ?? null,
    user,
    logout,
  }
}
```

## CSP Verification

In `tauri.conf.json` confirm these are present:
```
frame-src https://*.privy.io
connect-src https://*.privy.io
```

Without `frame-src`, Privy's key enclave iframe will be blocked → embedded wallet silently fails.

## Known Issue: Tauri WebView2 (Windows)

WebView2 may block third-party cookies used by Privy's iframe. If embedded wallet fails to initialize:

**Fix:** Add to `tauri.conf.json`:
```json
{
  "webview": {
    "additionalBrowserArgs": "--disable-features=BlockThirdPartyCookies"
  }
}
```

Only apply this if Privy iframe auth actually breaks — don't pre-apply.

## Acceptance Criteria

- [ ] Login screen appears on first launch
- [ ] "Connect Wallet" opens Privy modal
- [ ] After login: wallet address shown in app header
- [ ] `embeddedWallet.address` returns valid Solana public key
- [ ] Logout clears session, returns to login screen
- [ ] No CSP errors in DevTools console
