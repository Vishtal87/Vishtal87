import { chromium } from 'playwright'
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark', locale: 'ru-RU' })
await page.goto('http://localhost:5173/?event=2&c=45.2,39.2,10.5')
await page.waitForTimeout(6000)
const probe = async (tag) => {
  const r = await page.evaluate(() => {
    const el = document.querySelector('.summary')
    const box = el.getBoundingClientRect()
    const top = document.elementFromPoint(box.x + 20, box.y + 8)
    return { top: top?.className, topTag: top?.tagName, opacity: getComputedStyle(el.closest('.panel__inner')).opacity }
  })
  console.log(tag, JSON.stringify(r))
}
await probe('before')
await fetch('http://127.0.0.1:8090/control/release?n=1', { method: 'POST' })
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(5000)
  await probe(`t+${(i + 1) * 5}s`)
  if (i === 7) await page.screenshot({ path: '../.run/shots/glitch.png' })
}
await browser.close()
