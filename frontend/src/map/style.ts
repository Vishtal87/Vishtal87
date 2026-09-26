/** Base map style: fully self-hosted (PostGIS vector tiles + local glyphs), globe projection with atmosphere. */
import type { StyleSpecification } from 'maplibre-gl'

export interface Palette {
  space: string; ocean: string; land: string; border: string; label: string; halo: string; dots: string
  sky: string; horizon: string
  glow: string; glowOpacity: number        // soft light along the coasts and borders
  night: [number, number, number]; nightAlpha: number; lights: string  // night side and city lights
}

export const DARK: Palette = {
  space: '#02040a', ocean: '#061833', land: '#14233d', border: '#3a5580', label: '#b3c0d8', halo: '#061833',
  dots: '#6a7c9c', sky: '#0b2350', horizon: '#5b9dff', glow: '#4d8ff0', glowOpacity: 0.5,
  night: [1, 4, 14], nightAlpha: 0.62, lights: '#ffcf7a',
}
export const LIGHT: Palette = {
  space: '#dfe7f2', ocean: '#bcd3ee', land: '#f4f1ea', border: '#a9b3c4', label: '#3d4656', halo: '#f4f1ea',
  dots: '#8a94a6', sky: '#9fc3f0', horizon: '#ffffff', glow: '#7fa6d9', glowOpacity: 0.25,
  night: [18, 34, 70], nightAlpha: 0.3, lights: '#ffb347',
}

export const skySpec = (p: Palette) => ({
  'sky-color': p.sky, 'horizon-color': p.horizon, 'fog-color': p.ocean, 'sky-horizon-blend': 0.75,
  'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 7, 0],
}) as StyleSpecification['sky']

export function baseStyle(p: Palette, lang: string): StyleSpecification {
  const origin = window.location.origin
  return {
    version: 8,
    projection: { type: 'globe' },
    glyphs: `${origin}/glyphs/{fontstack}/{range}.pbf`,
    sky: skySpec(p),
    sources: {
      base: {
        type: 'vector',
        tiles: [`${origin}/tiles/base/{z}/{x}/{y}.pbf?lang=${lang}`],
        maxzoom: 12,
        attribution: '© GeoNames (CC-BY 4.0) · Natural Earth',
      },
    },
    layers: [
      { id: 'ocean', type: 'background', paint: { 'background-color': p.ocean } },
      { id: 'land', type: 'fill', source: 'base', 'source-layer': 'countries', paint: { 'fill-color': p.land } },
      {
        id: 'coast-glow', type: 'line', source: 'base', 'source-layer': 'countries',
        paint: {
          'line-color': p.glow, 'line-blur': ['interpolate', ['linear'], ['zoom'], 0, 2.5, 5, 4],
          'line-width': ['interpolate', ['linear'], ['zoom'], 0, 2.2, 4, 4.5, 7, 6],
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 0, p.glowOpacity, 5, p.glowOpacity * 0.35, 7.5, 0],
        },
      },
      {
        id: 'borders', type: 'line', source: 'base', 'source-layer': 'countries',
        paint: { 'line-color': p.border, 'line-width': ['interpolate', ['linear'], ['zoom'], 1, 0.4, 6, 1.1] },
      },
      {
        id: 'place-dots', type: 'circle', source: 'base', 'source-layer': 'places', minzoom: 4,
        filter: ['==', ['get', 'kind'], 'locality'],
        paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 1, 10, 2.4], 'circle-color': p.dots,
          'circle-opacity': 0.8 },
      },
      {
        id: 'place-labels', type: 'symbol', source: 'base', 'source-layer': 'places',
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Noto Sans Regular'],
          'text-size': ['match', ['get', 'kind'], 'country', 13, 'admin1', 11.5,
            ['interpolate', ['linear'], ['get', 'population'], 0, 11, 1000000, 13.5]],
          'text-letter-spacing': ['match', ['get', 'kind'], 'country', 0.08, 0.01],
          'text-transform': ['match', ['get', 'kind'], 'country', 'uppercase', 'none'],
          'text-variable-anchor': ['top', 'bottom', 'left', 'right'],
          'text-radial-offset': 0.6,
          'text-max-width': 8,
          'symbol-sort-key': ['-', 0, ['get', 'population']],
          'text-padding': 4,
        },
        paint: {
          'text-color': ['match', ['get', 'kind'], 'country', p.label, 'admin1', p.dots, p.label],
          'text-halo-color': p.halo, 'text-halo-width': 1.3, 'text-opacity': 0.9,
        },
      },
    ],
  }
}
