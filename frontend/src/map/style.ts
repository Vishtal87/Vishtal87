/** Base map style: fully self-hosted (PostGIS vector tiles + local glyphs), globe projection with atmosphere. */
import type { StyleSpecification } from 'maplibre-gl'

export interface Palette {
  space: string; ocean: string; land: string; border: string; label: string; halo: string; dots: string
  sky: string; horizon: string
}

export const DARK: Palette = {
  space: '#03050b', ocean: '#08142a', land: '#1a2436', border: '#3a4a66', label: '#a7b3ca', halo: '#08142a',
  dots: '#5d6d88', sky: '#0b1a33', horizon: '#3b6fb6',
}
export const LIGHT: Palette = {
  space: '#dfe7f2', ocean: '#bcd3ee', land: '#f4f1ea', border: '#a9b3c4', label: '#3d4656', halo: '#f4f1ea',
  dots: '#8a94a6', sky: '#9fc3f0', horizon: '#ffffff',
}

export function baseStyle(p: Palette, lang: string): StyleSpecification {
  const origin = window.location.origin
  return {
    version: 8,
    projection: { type: 'globe' },
    glyphs: `${origin}/glyphs/{fontstack}/{range}.pbf`,
    sky: {
      'sky-color': p.sky,
      'horizon-color': p.horizon,
      'fog-color': p.ocean,
      'sky-horizon-blend': 0.6,
      'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 7, 0],
    },
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
