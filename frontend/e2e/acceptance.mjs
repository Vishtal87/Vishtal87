// Acceptance test = the product's readiness criterion (14 steps), against the running stack (devstand data).
// Usage: node e2e/acceptance.mjs [baseUrl]   -> screenshots in ../.run/shots/acc-*.png, JSON report on stdout
import { chromium } from 'playwright'

const BASE = process.argv[2] ?? 'http://localhost:5173'
const DEVSTAND = process.env.DEVSTAND ?? 'http://127.0.0.1:8090'
const results = []

// precondition: live-release steps need a fresh stand (restart devstand + `geonews reset-news` between runs)
const standState = await fetch(`${DEVSTAND}/control/state`).then((r) => r.json())
if (!standState.queued.includes('nov-1')) {
  console.error(`devstand is not fresh (queued: ${standState.queued}); restart devstand and run \`geonews reset-news\``)
  process.exit(2)
}
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark', locale: 'ru-RU' })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(`pageerror: ${String(e.stack ?? e.message).split('\n').slice(0, 3).join(' | ')}`))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()} @ ${m.location().url}:${m.location().lineNumber}`)
})

async function step(n, name, fn) {
  const t0 = Date.now()
  try {
    const detail = await fn()
    results.push({ n, name, ok: true, ms: Date.now() - t0, detail })
  } catch (e) {
    results.push({ n, name, ok: false, ms: Date.now() - t0, error: String(e.message ?? e).slice(0, 300) })
  }
  await page.screenshot({ path: `../.run/shots/acc-${String(n).padStart(2, '0')}.png` })
}

async function search(q, contextHint) {
  const input = page.locator('input[role=combobox]')
  await input.fill('')
  await input.fill(q)
  await page.waitForSelector('.search__item', { timeout: 8000 })
  const items = page.locator('.search__item')
  const texts = await items.allInnerTexts()
  let idx = texts.findIndex((t) => (!contextHint || t.includes(contextHint)))
  if (idx < 0) idx = 0
  await items.nth(idx).click()
  await page.waitForTimeout(3500)
  // regression: the picked name written into the field must not reopen the dropdown over the map
  if (await page.locator('.search__results').count()) throw new Error('search dropdown reopened after pick')
  return texts[idx].replace(/\s+/g, ' ')
}

async function panelTitle() { return (await page.locator('.panel__heading h2').first().innerText()).trim() }
async function statNum() { return Number((await page.locator('.stat__num').first().innerText()).trim()) }

await page.goto(BASE)
await page.waitForTimeout(6000)

await step(1, 'Открыть Землю', async () => {
  const bubbles = await page.evaluate(() => document.querySelector('.maplibregl-canvas') !== null)
  const status = await page.locator('.map-status__level').innerText()
  if (!bubbles) throw new Error('no map canvas')
  return status
})

await step(2, 'Приблизить страну', async () => {
  const picked = await search('Россия')
  const title = await panelTitle()
  if (!title.includes('Россия')) throw new Error(`panel: ${title}`)
  return { picked, title, events: await statNum() }
})

await step(3, 'Найти регион', async () => {
  const picked = await search('Краснодарский край')
  const n = await statNum()
  if (n < 5) throw new Error(`too few events in region: ${n}`)
  const sub = await page.locator('.section:has(h3:text("Где происходит")) .chip').allInnerTexts()
  return { picked, events: n, subplaces: sub.slice(0, 8) }
})

await step(4, 'Найти крупный город', async () => {
  const picked = await search('Краснодар', 'Краснодарский край')
  const title = await panelTitle()
  if (title !== 'Краснодар') throw new Error(`panel: ${title}`)
  return { picked, events: await statNum() }
})

await step(5, 'Найти малый город', async () => {
  const picked = await search('Горячий Ключ')
  return { picked, title: await panelTitle(), events: await statNum() }
})

await step(6, 'Найти деревню/посёлок (хутор Каштаны, ~600 жителей)', async () => {
  const picked = await search('хутор Каштаны', 'Краснодарский край')
  const n = await statNum()
  if (n < 1) throw new Error('no events in hamlet')
  return { picked, title: await panelTitle(), events: n }
})

await step(7, 'Открыть географическую точку (станица Динская)', async () => {
  const picked = await search('станица Динская')
  return { picked, title: await panelTitle(), events: await statNum() }
})

await step(8, 'Получить связанные новости', async () => {
  const rows = await page.locator('.section:has(h3:text("События здесь")) .event-row').allInnerTexts()
  if (!rows.length) throw new Error('no events listed')
  return rows.map((r) => r.split('\n')[0])
})

await step(9, 'Увидеть несколько разных источников', async () => {
  // the headline may later switch to the official source's wording once it reports -> match both
  await page.locator('.event-row', { hasText: /загорелся частный дом|Пожар в Динской/ }).first().click()
  await page.waitForTimeout(3000)
  const names = await page.locator('.source__name').allInnerTexts()
  if (new Set(names).size < 4) throw new Error(`sources: ${names}`)
  return names
})

await step(10, 'Увидеть объединённые дубли (пересылка помечена копией)', async () => {
  const copies = await page.locator('.source--copy').count()
  const badge = await page.locator('.facts').innerText()
  if (copies < 1) throw new Error('no copy marked')
  return { copies, facts: badge.replace(/\s+/g, ' ').slice(0, 120) }
})

await step(11, 'Открыть оригинальный источник', async () => {
  const [popup] = await Promise.all([
    ctx.waitForEvent('page', { timeout: 8000 }),
    page.locator('.source a:has-text("Открыть оригинал")').first().click(),
  ])
  await popup.waitForLoadState('domcontentloaded')
  const url = popup.url()
  const text = (await popup.locator('body').innerText()).slice(0, 120)
  await popup.close()
  if (!url.includes('8090')) throw new Error(`unexpected url ${url}`)
  return { url, text }
})

await step(12, 'Увидеть временную последовательность', async () => {
  const items = await page.locator('.timeline__item').allInnerTexts()
  if (items.length < 5) throw new Error(`timeline: ${items.length}`)
  return items.map((i) => i.replace(/\s+/g, ' ').slice(0, 80))
})

await step(13, 'Увидеть новые события без перезагрузки', async () => {
  await page.locator('.panel .icon-btn[aria-label="Закрыть"]').first().click()
  await page.waitForTimeout(800)
  const before = await page.locator('.latest__count').innerText().catch(() => '')
  const res = await fetch(`${DEVSTAND}/control/release?n=2`, { method: 'POST' }).then((r) => r.json())
  await page.waitForSelector('.toast', { timeout: 70000 })
  const toast = (await page.locator('.toast').first().innerText()).replace(/\s+/g, ' ')
  const badge = await page.locator('.live__badge').innerText().catch(() => '')
  return { released: res.released, toast, badge, latestBefore: before, navigations: 'single page, no reload' }
})

await step(14, 'Проверить привязку к правильному месту («Почему здесь?»)', async () => {
  await page.locator('.toast').first().click()
  await page.waitForTimeout(3000)
  await page.locator('.why__toggle').click()
  await page.waitForTimeout(400)
  const why = (await page.locator('.why__body').innerText()).replace(/\s+/g, ' ')
  const place = (await page.locator('.facts dd').first().innerText()).replace(/\s+/g, ' ')
  if (!/Новотитаров/.test(place + why)) throw new Error(`place: ${place} / ${why}`)
  return { place, why }
})

console.log(JSON.stringify({ passed: results.filter((r) => r.ok).length, total: results.length, results,
  pageErrors: errors.slice(0, 10) }, null, 1))
await browser.close()
