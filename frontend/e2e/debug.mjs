import { chromium } from 'playwright'
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
const logs = []
page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`))
page.on('requestfailed', (r) => logs.push(`reqfail: ${r.url()} ${r.failure()?.errorText}`))
page.on('response', (r) => { if (r.status() >= 400) logs.push(`http ${r.status()} ${r.url()}`) })
await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(6000)
const info = await page.evaluate(() => {
  const c = document.createElement('canvas')
  const gl = c.getContext('webgl2') || c.getContext('webgl')
  const cv = document.querySelector('.maplibregl-canvas')
  return { webgl: !!gl, renderer: gl ? gl.getParameter(gl.RENDERER) : null, canvas: cv ? [cv.width, cv.height, getComputedStyle(cv).display] : null,
    globeEl: document.querySelector('.globe')?.getBoundingClientRect() }
})
console.log(JSON.stringify(info))
console.log(logs.slice(0, 30).join('\n'))
await browser.close()
