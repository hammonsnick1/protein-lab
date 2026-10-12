#!/usr/bin/env bash
# Rebuilds Protein Lab from source with freshly downloaded dependencies and
# installs it into this folder.
#
#   1. Engine: new Python environment, tests, PyInstaller build
#   2. Desktop app: clean `npm ci`, lint, type-check, AppImage package
#   3. Install: app/Protein-Labs.AppImage (the build it replaces is kept as
#      app/Protein-Labs.previous.AppImage), the app-menu entry, and
#      ~/.local/bin/protein-labs
#
# Your projects in data/ are never touched by this script.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
backend="$root/protein-labs/backend"
web="$root/protein-labs-web"
applications="$HOME/.local/share/applications"

step() { printf '\n==> %s\n' "$*"; }

if ss -ltn 2>/dev/null | grep -q ':8770 '; then
  echo "Protein Lab is running (its engine holds port 8770). Close it, then rerun." >&2
  exit 1
fi

step "Engine: fresh Python environment"
rm -rf "$backend/.venv" "$backend/build" "$backend/dist"
python3 -m venv "$backend/.venv"
"$backend/.venv/bin/python" -m pip install --quiet --upgrade pip
"$backend/.venv/bin/python" -m pip install --quiet -r "$backend/requirements-dev.txt" pyinstaller

step "Engine: tests"
(cd "$backend" && .venv/bin/python -m pytest tests -q)

step "Engine: build"
(cd "$backend" && .venv/bin/python -m PyInstaller --noconfirm --clean --log-level WARN protein-labs-backend.spec)

step "Desktop app: clean install of dependencies"
cd "$web"
rm -rf node_modules desktop-dist release
npm ci
# Electron fetches its runtime in an install script; run it if npm skipped it.
[[ -x node_modules/electron/dist/electron ]] || node node_modules/electron/install.js

step "Desktop app: lint and type-check"
npm run lint
npx tsc --noEmit -p .

step "Desktop app: package"
npm run desktop:package
built="$(ls -t release/*.AppImage | head -n 1)"

step "Install into $root"
mkdir -p "$root/app" "$root/data"
if [[ -f "$root/app/Protein-Labs.AppImage" ]]; then
  mv -f "$root/app/Protein-Labs.AppImage" "$root/app/Protein-Labs.previous.AppImage"
fi
install -m 755 "$built" "$root/app/Protein-Labs.AppImage"
install -m 644 "$web/desktop/assets/icon.png" "$root/app/icon.png"
chmod +x "$root/protein-lab"

mkdir -p "$HOME/.local/bin" "$applications"
ln -sfn "$root/protein-lab" "$HOME/.local/bin/protein-labs"
cat > "$applications/protein-labs.desktop" <<EOF
[Desktop Entry]
Name=Protein Lab
GenericName=Protein Science Workspace
Comment=Plan, execute, and analyze protein purification projects
Exec=$root/protein-lab
Icon=$root/app/icon.png
Terminal=false
Type=Application
Categories=Science;Education;
StartupNotify=true
StartupWMClass=protein-labs
EOF
command -v update-desktop-database >/dev/null && update-desktop-database "$applications" || true

step "Done"
echo "  App:      $root/app/Protein-Labs.AppImage"
echo "  Data:     $root/data"
echo "  Launch:   protein-labs   (or Protein Lab in the app menu)"
