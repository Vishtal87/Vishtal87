import { chromium } from 'playwright'
const [qs, sel] = process.argv.slice(2)
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark', locale: 'ru-RU' })
await page.goto(`http://localhost:5173/${qs}`)
await page.waitForTimeout(6000)
const r = await page.evaluate((sel) => [...document.querySelectorAll(sel)].slice(0, 3).map((el) => {
  const out = []
  let e = el
  while (e && e !== document.body) { const cs = getComputedStyle(e); out.push(`${e.className}: color=${cs.color} opacity=${cs.opacity} filter=${cs.filter}`); e = e.parentElement }
  return out.join('\n')
}), sel)
console.log(r.join('\n---\n'))
await browser.close()
