#!/usr/bin/env bash
# Download FULL GeoNames dumps (all populated places incl. hamlets, ADM1..ADM5, alternate names).
# Usage: scripts/fetch_geonames.sh RU DE US      (per-country files)
#        scripts/fetch_geonames.sh allCountries  (whole planet, ~400 MB zipped)
# Licence: CC-BY 4.0 — attribution "GeoNames (geonames.org)" is shown in the UI.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/data/geonames"
BASE="https://download.geonames.org/export/dump"
mkdir -p "$DEST"
cd "$DEST"
for f in countryInfo.txt admin1CodesASCII.txt admin2Codes.txt; do
  [ -f "$f" ] || curl -fsSLO "$BASE/$f"
done
for c in "$@"; do
  [ -f "$c.txt" ] || { curl -fsSLO "$BASE/$c.zip" && unzip -o -q "$c.zip" "$c.txt" && rm -f "$c.zip"; }
  # alternate names with language tags (per country), used for multilingual search & display
  if [ "$c" != "allCountries" ] && [ ! -f "alternatenames_$c.txt" ]; then
    curl -fsSLO "$BASE/alternatenames/$c.zip" && unzip -o -q "$c.zip" "$c.txt" -d alt && mv "alt/$c.txt" "alternatenames_$c.txt" && rm -rf alt "$c.zip"
  fi
done
echo "GeoNames files in $DEST"
