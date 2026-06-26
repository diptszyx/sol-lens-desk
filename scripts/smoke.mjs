// Headless smoke test for the desktop UI.
// Mocks Tauri's IPC so we can inject `token_detected` events the way the Rust
// backend would, then drives the real React app and asserts it does not crash.
// Run against a live vite dev server (pnpm dev) on :1420.
//
//   node scripts/smoke.mjs
//
// Catches the class of bug that produced the black screen (render throws /
// infinite update loops) without needing a native window or Privy login.
// Two passes: the dashboard window ('main') and the capybara overlay ('pet').

import { createRequire } from 'module'
import { existsSync } from 'fs'
const require = createRequire(import.meta.url)
// playwright is a workspace devDep (not hoisted to the desktop app); resolve it
// from the pnpm store, falling back to normal resolution.
const PW = '/Users/tho/project/sol-lens/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright'
const { chromium } = require(existsSync(PW) ? PW : 'playwright')

const BASE = process.env.SMOKE_URL ?? 'http://localhost:1420'

// Faithful-enough mock of Tauri internals: per-window metadata (so window
// routing + WebviewWindow.getByLabel work), event listen/emit, and the
// listener-unregister hook.
const tauriMock = (label) => `
window.__TAURI_INTERNALS__ = {
  _cbs: {}, _id: 0, _listeners: {},
  metadata: {
    currentWindow: { label: ${JSON.stringify(label)} },
    currentWebview: { windowLabel: ${JSON.stringify(label)}, label: ${JSON.stringify(label)} },
    windows: [{ label: 'main' }, { label: 'pet' }],
    webviews: [{ windowLabel: 'main', label: 'main' }, { windowLabel: 'pet', label: 'pet' }],
  },
  transformCallback(cb, once) { const id = ++this._id; this._cbs[id] = cb; return id },
  unregisterCallback(id) { delete this._cbs[id] },
  async invoke(cmd, args) {
    if (cmd === 'plugin:event|listen') {
      const eid = ++this._id;
      (this._listeners[args.event] ||= []).push(args.handler);
      return eid;
    }
    if (cmd === 'plugin:window|get_all_windows') return ['main', 'pet'];
    if (cmd === 'plugin:window|current_monitor' || cmd === 'plugin:window|primary_monitor') {
      return {
        name: 'mock', scaleFactor: 2,
        size: { width: 1440, height: 900 }, position: { x: 0, y: 0 },
        workArea: { size: { width: 1440, height: 900 }, position: { x: 0, y: 0 } },
      };
    }
    if (cmd === 'plugin:window|scale_factor') return 2;
    return undefined; // unlisten, window ops, app commands -> no-op
  },
  convertFileSrc(p) { return p },
}
window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener(event, eventId) {} }
window.__emitTauri = (event, payload) => {
  for (const handlerId of (window.__TAURI_INTERNALS__._listeners[event] || [])) {
    const cb = window.__TAURI_INTERNALS__._cbs[handlerId];
    if (cb) cb({ event, id: handlerId, payload });
  }
}
`

const mkToken = (over) => ({
  mint: 'Mint1111111111111111111111111111111111111111',
  symbol: 'PEPE', name: 'Pepe', decimals: 6,
  price_usd: 0.0000123, liquidity_sol: 42.5, market_cap_usd: 55000,
  volume_24h: 12000, holder_count: 120, age_seconds: 8,
  source: 'pump_fun', detected_at: Date.now(),
  dev_address: 'Dev11111111111111111111111111111111111111',
  dev_hold_pct: 8, bonding_curve_pct: 25, dev_buy_sol: 1.2, has_socials: true,
  ...over,
})

const fail = (m) => { console.error('FAIL:', m); process.exitCode = 1 }

const browser = await chromium.launch()

async function dashboardPass() {
  console.log('\n— dashboard (main) —')
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push('[console] ' + m.text()) })
  await page.addInitScript(tauriMock('main'))

  try {
    await page.goto(BASE + '/#devdash', { waitUntil: 'domcontentloaded', timeout: 20000 })
    await page.getByText(/\d+ \/ \d+ tokens/).waitFor({ timeout: 10000 })

    await page.evaluate(([a, b, c]) => {
      window.__emitTauri('token_detected', a)
      window.__emitTauri('token_detected', b)
      window.__emitTauri('token_detected', a) // duplicate mint
      window.__emitTauri('token_detected', c) // unnamed -> filtered out
    }, [
      mkToken({ mint: 'AAA', symbol: 'AAA' }),
      mkToken({ mint: 'BBB', symbol: 'BBB', dev_hold_pct: 30 }),
      mkToken({ mint: 'CCC', symbol: '?' }),
    ])

    await page.waitForTimeout(1500)

    const countText = await page.getByText(/\/ \d+ tokens/).innerText()
    const rows = await page.locator('button:has-text("$AAA"), button:has-text("$BBB")').count()
    const unnamed = await page.locator('div.flex-1 button:has-text("$?")').count()
    const devBadge = await page.getByText(/dev \d/).count()
    const curveBadge = await page.getByText(/curve \d/).count()
    const loop = errors.find((e) => /Maximum update depth|Too many re-renders/i.test(e))

    console.log('countText  :', JSON.stringify(countText))
    console.log('feed rows  :', rows)
    console.log('unnamed    :', unnamed, '(want 0 — filtered)')
    console.log('dev badges :', devBadge)
    console.log('curve badges:', curveBadge)
    console.log('pageerrors :', errors.length ? errors : '(none)')

    if (loop) fail('infinite render loop: ' + loop)
    if (errors.length) fail('dashboard runtime errors present')
    if (!/^2 \/ 3 tokens/.test(countText)) fail(`expected "2 / 3 tokens", got ${JSON.stringify(countText)}`)
    if (rows < 2) fail(`expected >=2 feed rows, got ${rows}`)
    if (unnamed !== 0) fail('unnamed "?" token should be filtered out by default')
    if (devBadge < 1) fail('expected dev-hold signal badge to render')
    if (curveBadge < 1) fail('expected bonding-curve signal badge to render')
  } finally {
    await page.close()
  }
}

async function petPass() {
  console.log('\n— pet overlay (pet) —')
  const page = await browser.newPage({ viewport: { width: 360, height: 480 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push('[console] ' + m.text()) })
  await page.addInitScript(tauriMock('pet'))

  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 20000 })
    // Capybara overlay root renders an SVG capybara always.
    await page.locator('svg').first().waitFor({ timeout: 10000 })

    // New token -> speech bubble.
    await page.evaluate((t) => window.__emitTauri('token_detected', t), mkToken({ mint: 'PET', symbol: 'WIF' }))
    await page.getByText('$WIF').waitFor({ timeout: 5000 })
    const bubble = await page.getByText(/New/).count()

    // Hover -> trade card with the 4 stats + a buy button.
    await page.mouse.move(10, 10)
    await page.mouse.move(180, 460)
    await page.getByText('Price', { exact: true }).first().waitFor({ timeout: 5000 })
    const priceStat = await page.getByText('Price', { exact: true }).count()
    const liqStat = await page.getByText('Liquidity', { exact: true }).count()
    const buyBtn = await page.getByRole('button', { name: /Buy 0\.1/ }).count()
    const loop = errors.find((e) => /Maximum update depth|Too many re-renders/i.test(e))

    console.log('bubble     :', bubble)
    console.log('price stat :', priceStat)
    console.log('liq stat   :', liqStat)
    console.log('buy button :', buyBtn)
    console.log('pageerrors :', errors.length ? errors : '(none)')

    if (loop) fail('infinite render loop: ' + loop)
    if (errors.length) fail('pet runtime errors present')
    if (bubble < 1) fail('expected speech bubble on token alert')
    if (priceStat < 1 || liqStat < 1) fail('expected trade card stats on hover')
    if (buyBtn < 1) fail('expected buy button on hover card')
  } finally {
    await page.close()
  }
}

try {
  await dashboardPass()
  await petPass()
  if (!process.exitCode) {
    console.log('\nPASS ✅  dashboard feed/filter/badges/dedup + pet alert/hover-card, no crash')
  }
} catch (e) {
  fail(e.message)
} finally {
  await browser.close()
}
