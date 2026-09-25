// Copies Noto Sans SDF glyphs (smp-noto-glyphs, MIT; fonts OFL) into public/glyphs so map labels work
// without any external glyph server. Missing ranges get an empty PBF (MapLibre renders nothing, no 404s).
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const src = path.join(path.dirname(require.resolve('smp-noto-glyphs/package.json')), 'fixtures', 'glyphs')
const dest = path.join(import.meta.dirname, '..', 'public', 'glyphs', 'Noto Sans Regular')
fs.mkdirSync(dest, { recursive: true })
let copied = 0
for (let start = 0; start < 65536; start += 256) {
  const range = `${start}-${start + 255}`
  const gz = path.join(src, `${range}.pbf.gz`)
  const out = path.join(dest, `${range}.pbf`)
  if (fs.existsSync(gz)) {
    fs.writeFileSync(out, zlib.gunzipSync(fs.readFileSync(gz)))
    copied++
  } else {
    fs.writeFileSync(out, Buffer.alloc(0))
  }
}
console.log(`glyphs: ${copied} ranges copied, others empty -> ${dest}`)
