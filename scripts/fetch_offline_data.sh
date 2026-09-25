#!/usr/bin/env bash
# Fetch the offline geographic bundle (works where only package registries are reachable).
#   * world-atlas   — Natural Earth country polygons (public domain)
#   * cities.json   — GeoNames admin1/admin2 code names + cities (CC-BY 4.0)
#   * iso3166-2-db  — localized country/region names with GeoNames/OSM references
# GeoNames cities500 (with multilingual alternate names) comes from the PyPI package `geonamescache`.
# For the FULL gazetteer (every village/hamlet) use scripts/fetch_geonames.sh (needs download.geonames.org).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/data/vendor"
mkdir -p "$DEST"
cd "$DEST"
for spec in world-atlas@2.0.2 cities.json@1.1.64 iso3166-2-db@2.3.11; do
  name="${spec%@*}"
  if [ -d "$name" ]; then echo "✓ $name"; continue; fi
  tgz=$(npm pack --silent "$spec")
  mkdir -p "$name" && tar -xzf "$tgz" -C "$name" --strip-components=1 && rm -f "$tgz"
  echo "↓ $name"
done
