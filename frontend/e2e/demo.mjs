// Records a walkthrough video of the running stack (needs a fresh devstand for the live step).
// Usage: node e2e/demo.mjs [baseUrl]   -> ../.run/demo/*.webm + key screenshots
import { chromium } from 'playwright'

const BASE = process.argv[2] ?? 'http://localhost:5173'
const DEVSTAND = process.env.DEVSTAND ?? 'http://127.0.0.1:8090'
const OUT = '../.run/demo'
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'dark', locale: 'ru-RU',
  recordVideo: { dir: OUT, size: { width: 1280, height: 800 } } })
const page = await ctx.newPage()
const pause = (ms) => page.waitForTimeout(ms)
const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png` })

async function search(q, hint) {
  const input = page.locator('input[role=combobox]')
  await input.fill('')
  await input.pressSequentially(q, { delay: 70 })
  await page.waitForSelector('.search__item', { timeout: 8000 })
  await pause(900)
  const items = page.locator('.search__item')
  const texts = await items.allInnerTexts()
  const idx = Math.max(0, texts.findIndex((t) => !hint || t.includes(hint)))
  await items.nth(idx).click()
  await pause(4000)
}

await page.goto(BASE)
await pause(6000)
await shot('01-globe')
await search('Россия')
await search('Краснодарский край')
await shot('02-region')
await search('хутор Каштаны', 'Краснодарский край')
await shot('03-hamlet')
await search('станица Динская')
await page.locator('.event-row', { hasText: /загорелся частный дом|Пожар в Динской/ }).first().click()
await pause(3500)
await shot('04-event')
await page.locator('.why__toggle').click()
await pause(2500)
await shot('05-why-here')
const scroll = (dy) => page.locator('.panel__scroll').first().evaluate((el, d) => el.scrollBy({ top: d, behavior: 'smooth' }), dy)
await scroll(560)
await pause(2500)
await shot('06-sources')
await scroll(1400)
await pause(2500)
await shot('07-timeline')
await page.locator('.panel .icon-btn[aria-label="Закрыть"]').first().click()
await pause(1500)
await fetch(`${DEVSTAND}/control/release?n=2`, { method: 'POST' })
await page.waitForSelector('.toast', { timeout: 90000 })
await pause(2500)
await shot('08-live-toast')
await page.locator('.toast').first().click()
await pause(4000)
await shot('09-live-event')
await ctx.close()
await browser.close()
console.log('video saved in', OUT)
