#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="${HOME}/.local/bin"
NODE_BIN="$(command -v node || true)"

if [ -z "$NODE_BIN" ]; then
  echo "[ERROR] Node.js v20+ was not found. Install Node.js before running this installer." >&2
  exit 1
fi

NODE_MAJOR="$("$NODE_BIN" -p 'Number(process.versions.node.split(".")[0])')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "[ERROR] Node.js v20+ is required; found $NODE_MAJOR." >&2
  exit 1
fi

if [ ! -d "$DIR/node_modules" ] || [ ! -d "$DIR/packages/cli/node_modules" ]; then
  echo "[ERROR] OmniCode dependencies are missing. Run 'bun install' in $DIR first." >&2
  exit 1
fi

BUN_BIN="$("$NODE_BIN" --input-type=module -e 'import { pathToFileURL } from "node:url"; import(pathToFileURL(process.argv[1]).href).then(({ findBun }) => { const bun = findBun(); if (!bun) process.exitCode = 1; else process.stdout.write(bun) })' "$DIR/bin/omni-runtime.js")" || {
  echo "[ERROR] Bun was not found. Install Bun or set BUN_BIN to its absolute executable path." >&2
  exit 1
}

if ! "$BUN_BIN" --version >/dev/null; then
  echo "[ERROR] The resolved Bun executable could not be run: $BUN_BIN" >&2
  exit 1
fi

mkdir -p "$TARGET_DIR"

cat <<EOF > "${TARGET_DIR}/omni"
#!/usr/bin/env bash
exec "${NODE_BIN}" "${DIR}/bin/omni.js" "\$@"
EOF

chmod +x "${TARGET_DIR}/omni"
ln -sf "${TARGET_DIR}/omni" "${TARGET_DIR}/omnicode"

echo "OmniCode development shortcut installed at: ${TARGET_DIR}/omni"
echo "This shortcut uses the current source checkout; keep it and its dependencies available."
echo "There is no standalone OmniCode update channel yet; update this checkout manually."
echo "Ensure ${TARGET_DIR} is in your PATH."

