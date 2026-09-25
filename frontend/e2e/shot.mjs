// Screenshot helper: node e2e/shot.mjs <name> "<query string>" [width height] [waitMs]
import { chromium } from 'playwright'
const [name, qs = '', w = '1440', h = '900', wait = '5000'] = process.argv.slice(2)
const BASE = process.env.BASE ?? 'http://localhost:5173'
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) }, deviceScaleFactor: 1,
  colorScheme: process.env.THEME ?? 'dark', locale: process.env.LOCALE ?? 'ru-RU' })
const logs = []
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`${m.type()}: ${m.text()}`) })
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`))
await page.goto(`${BASE}/${qs}`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(Number(wait))
await page.screenshot({ path: `../.run/shots/${name}.png` })
console.log(JSON.stringify({ name, logs: logs.slice(0, 10) }))
await browser.close()
