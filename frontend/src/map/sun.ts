/**
 * Where the Sun is, and what the night side of the globe looks like right now.
 * Low-precision solar ephemeris (error well under 0.1°, plenty for shading a map).
 */
const RAD = Math.PI / 180
const MERC_LAT = 85.0511

/** Subsolar point: the place where the Sun is at the zenith. */
export function subsolarPoint(date: Date): { lat: number; lon: number } {
  const d = date.getTime() / 86_400_000 - 10_957.5            // days since J2000.0 (2000-01-01 12:00 UTC)
  const g = (357.529 + 0.98560028 * d) * RAD                   // mean anomaly
  const q = 280.459 + 0.98564736 * d                           // mean longitude
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD
  const e = (23.439 - 0.00000036 * d) * RAD                    // obliquity of the ecliptic
  const decl = Math.asin(Math.sin(e) * Math.sin(L))
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)) / RAD
  const gmst = (280.46061837 + 360.98564736629 * d) % 360       // Greenwich sidereal angle, degrees
  let lon = ra - gmst
  lon = ((lon + 540) % 360) - 180
  return { lat: decl / RAD, lon }
}

/** Sine of the Sun's elevation at a place. */
export function sunSine(lat: number, lon: number, sun: { lat: number; lon: number }): number {
  return Math.sin(lat * RAD) * Math.sin(sun.lat * RAD)
    + Math.cos(lat * RAD) * Math.cos(sun.lat * RAD) * Math.cos((lon - sun.lon) * RAD)
}

/** How dark it is at a place, 0 (day) … 1 (night): civil and nautical twilight make the soft band. */
export function nightness(sinEl: number): number {
  const x = Math.min(1, Math.max(0, -sinEl / 0.2))   // sin(-11.5°) ≈ -0.2
  return x * x * (3 - 2 * x)                           // smoothstep: no hard terminator line
}

/** The night side as a Web Mercator image (rows spaced like Mercator, so an image source maps it exactly). */
export function nightImage(date: Date, rgb: [number, number, number], maxAlpha: number, size = 512): string {
  const sun = subsolarPoint(date)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  const img = ctx.createImageData(size, size)
  const sinD = Math.sin(sun.lat * RAD), cosD = Math.cos(sun.lat * RAD)
  const cosDL = new Float32Array(size)
  for (let x = 0; x < size; x++) cosDL[x] = Math.cos((-180 + (360 * (x + 0.5)) / size - sun.lon) * RAD)
  const yMax = Math.log(Math.tan(Math.PI / 4 + (MERC_LAT * RAD) / 2))
  for (let y = 0; y < size; y++) {
    const my = yMax * (1 - (2 * (y + 0.5)) / size)
    const lat = 2 * Math.atan(Math.exp(my)) - Math.PI / 2
    const a = Math.sin(lat) * sinD, b = Math.cos(lat) * cosD
    for (let x = 0; x < size; x++) {
      const alpha = nightness(a + b * cosDL[x]) * maxAlpha
      const i = (y * size + x) * 4
      img.data[i] = rgb[0]; img.data[i + 1] = rgb[1]; img.data[i + 2] = rgb[2]
      img.data[i + 3] = Math.round(alpha * 255)
    }
  }
  ctx.putImageData(img, 0, 0)
  return canvas.toDataURL('image/png')
}

export const WORLD_MERCATOR: [[number, number], [number, number], [number, number], [number, number]] =
  [[-180, MERC_LAT], [180, MERC_LAT], [180, -MERC_LAT], [-180, -MERC_LAT]]
