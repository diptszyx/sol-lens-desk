import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  envPrefix: ['VITE_', 'TAURI_'],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, '../../shared'),
    },
  },
  build: {
    // Tauri loads bundles from local disk, so raw size is less critical than
    // for the web — split heavy deps into stable vendor chunks for faster
    // parse/startup and to keep rebuilds incremental.
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          privy: ['@privy-io/react-auth'],
          solana: ['@solana/kit', '@solana-program/memo', '@solana-program/system'],
        },
      },
    },
  },
})
