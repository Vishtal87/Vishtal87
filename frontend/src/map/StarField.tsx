/**
 * Deep-space backdrop behind the transparent globe canvas: a seeded star field with a faint Milky Way band,
 * drawn once per size on a canvas; a second small layer of brighter stars twinkles (CSS, off for reduced motion).
 */
import { useEffect, useRef } from 'react'

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296
  }
}

function draw(canvas: HTMLCanvasElement, bright: boolean) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const w = canvas.clientWidth, h = canvas.clientHeight
  canvas.width = Math.round(w * dpr)
  canvas.height = Math.round(h * dpr)
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.scale(dpr, dpr)
  ctx.clearRect(0, 0, w, h)
  const rand = rng(bright ? 7 : 42)
  if (!bright) {
    // the Milky Way: a soft diagonal glow made of many faint stars and a wide gradient
    ctx.save()
    ctx.translate(w / 2, h / 2)
    ctx.rotate(-0.42)
    const band = ctx.createLinearGradient(0, -h * 0.35, 0, h * 0.35)
    band.addColorStop(0, 'rgba(120,140,200,0)')
    band.addColorStop(0.5, 'rgba(120,140,200,0.07)')
    band.addColorStop(1, 'rgba(120,140,200,0)')
    ctx.fillStyle = band
    ctx.fillRect(-w, -h * 0.35, w * 2, h * 0.7)
    for (let i = 0; i < 900; i++) {
      const x = (rand() - 0.5) * w * 2, y = (rand() + rand() + rand() - 1.5) * h * 0.22
      ctx.fillStyle = `rgba(200,210,255,${0.08 + rand() * 0.18})`
      ctx.fillRect(x, y, 1, 1)
    }
    ctx.restore()
  }
  const n = Math.round((w * h) / (bright ? 16000 : 2600))
  for (let i = 0; i < n; i++) {
    const x = rand() * w, y = rand() * h
    const r = bright ? 0.8 + rand() * 1.1 : 0.3 + rand() * rand() * 1.1
    const tint = rand()
    const color = tint < 0.12 ? '255,214,170' : tint < 0.3 ? '180,205,255' : '255,255,255'
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fillStyle = `rgba(${color},${bright ? 0.9 : 0.25 + rand() * 0.55})`
    ctx.fill()
  }
}

export function StarField() {
  const base = useRef<HTMLCanvasElement>(null)
  const twinkle = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const redraw = () => {
      if (base.current) draw(base.current, false)
      if (twinkle.current) draw(twinkle.current, true)
    }
    redraw()
    let t: number | undefined
    const onResize = () => { window.clearTimeout(t); t = window.setTimeout(redraw, 200) }
    window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('resize', onResize); window.clearTimeout(t) }
  }, [])
  return (
    <div className="space" aria-hidden>
      <canvas ref={base} className="space__stars" />
      <canvas ref={twinkle} className="space__stars space__stars--twinkle" />
    </div>
  )
}
