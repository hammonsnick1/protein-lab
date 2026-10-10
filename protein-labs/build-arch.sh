#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
backend_dir="$project_dir/backend"
web_dir="$(cd "$project_dir/../protein-labs-web" && pwd)"
cache_dir="${TMPDIR:-/tmp}/protein-labs-arch-build-${UID}"

find_npm() {
  if command -v npm >/dev/null 2>&1 && npm --version >/dev/null 2>&1; then
    command -v npm
    return
  fi

  local npm_path
  npm_path="$(find "$HOME/.local/share/mise/installs/node" -mindepth 3 -maxdepth 3 \
    \( -type f -o -type l \) -name npm 2>/dev/null | sort -V | tail -n 1)"
  if [[ -z "$npm_path" ]]; then
    echo "Node.js 22 or newer and npm are required to build Protein Labs." >&2
    exit 1
  fi
  printf '%s\n' "$npm_path"
}

npm_path="$(find_npm)"
export PATH="$(dirname "$npm_path"):$PATH"
mkdir -p "$cache_dir/electron" "$cache_dir/electron-builder" "$cache_dir/xdg"
export XDG_CACHE_HOME="$cache_dir/xdg"
export electron_config_cache="$cache_dir/electron"
export ELECTRON_CACHE="$cache_dir/electron"
export ELECTRON_BUILDER_CACHE="$cache_dir/electron-builder"

if [[ ! -x "$backend_dir/.venv/bin/python" ]]; then
  python3 -m venv "$backend_dir/.venv"
fi
"$backend_dir/.venv/bin/python" -m pip install -r "$backend_dir/requirements.txt" pyinstaller

(
  cd "$backend_dir"
  "$backend_dir/.venv/bin/python" -m PyInstaller \
    --noconfirm --clean protein-labs-backend.spec
)

(
  cd "$web_dir"
  npm ci
  if [[ ! -x node_modules/electron/dist/electron ]]; then
    node node_modules/electron/install.js
  fi
  npm run desktop:package
  (
    cd packaging/arch
    makepkg --force --nodeps --cleanbuild
  )
  cp -f packaging/arch/protein-labs-*.pkg.tar.zst release/
)

echo
echo "Protein Labs packages are ready:"
find "$web_dir/release" -maxdepth 1 -type f \
  \( -name '*.AppImage' -o -name '*.pacman' -o -name '*.pkg.tar.zst' \) \
  -printf '  %p\n' | sort
