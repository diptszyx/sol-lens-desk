import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { getCurrentWindow } from '@tauri-apps/api/window'
import App from './App'
import { PetApp } from './components/pet/PetApp'
import './styles.css'

const root = createRoot(document.getElementById('root')!)

// Defaults to 'main' when Tauri metadata is unavailable (e.g. headless smoke
// test running in a plain browser).
function currentLabel(): string {
  try {
    return getCurrentWindow().label
  } catch {
    return 'main'
  }
}

const label = currentLabel()

if (label === 'pet') {
  // Transparent overlay: drop the dark boot background so the desktop shows
  // through around the capybara.
  document.documentElement.style.background = 'transparent'
  document.body.style.background = 'transparent'
  document.getElementById('boot')?.remove()
  root.render(
    <StrictMode>
      <PetApp />
    </StrictMode>,
  )
} else {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
