#!/bin/bash
# Rebuilds dist/index.html from the split source files in src/.
# Run this after editing anything in src/ — the app itself is one big
# self-contained HTML file (no bundler/build tool), so this is just a
# straight concatenation in the right order.
set -e
cd "$(dirname "$0")"

OUT=dist/index.html
mkdir -p dist
touch dist/.nojekyll   # serve dist/ as-is on GitHub Pages (skip Jekyll)

{
  cat src/head.html
  cat src/body.html
  echo '<script>'
  cat src/vendor/jspdf.umd.min.js
  echo ';'
  cat src/vendor/svg2pdf.umd.min.js
  echo ';'
  cat src/fonts/thai_fonts.js
  cat src/data/tspe_lms_and_cdc.js
  cat src/data/all_new_lms.js
  cat src/engine.js
  cat src/main.js
  echo '</script>'
  echo '</body></html>'
} > "$OUT"

echo "Built $OUT ($(wc -c < "$OUT") bytes)"

# quick sanity check: the concatenated <script> content must be valid JS
python3 - "$OUT" << 'PYEOF'
import re, subprocess, sys, tempfile
html = open(sys.argv[1], encoding='utf-8').read()
m = re.search(r'<script>(.*)</script>', html, re.DOTALL)
with tempfile.NamedTemporaryFile(suffix='.js', mode='w', delete=False, encoding='utf-8') as f:
    f.write(m.group(1))
    path = f.name
r = subprocess.run(['node', '--check', path])
sys.exit(r.returncode)
PYEOF
echo "JS syntax OK"
