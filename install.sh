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

cat <<EOF > "${TARGET_DIR}/onethy"
#!/usr/bin/env bash
exec "${NODE_BIN}" "${DIR}/bin/onethy.js" "\$@"
EOF
chmod +x "${TARGET_DIR}/onethy"
ln -sf "${TARGET_DIR}/onethy" "${TARGET_DIR}/onethy-code"

echo "OnethyCode CLI installed at: ${TARGET_DIR}/onethy"
echo "Legacy OmniCode shortcut installed at: ${TARGET_DIR}/omni"
echo "The CLI uses this source checkout; keep it and its dependencies available."

case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*)
    DESKTOP_SOURCE="$DIR/dist/desktop/app"
    DESKTOP_EXE="${DESKTOP_SOURCE}/OnethyCode.exe"
    if [ ! -f "$DESKTOP_EXE" ]; then DESKTOP_EXE="${DESKTOP_SOURCE}/OnethyCode Dev.exe"; fi
    if [ -f "$DESKTOP_EXE" ]; then
      DESKTOP_INSTALL="$LOCALAPPDATA/Programs/OnethyCode/app"
      mkdir -p "$(dirname "$DESKTOP_INSTALL")"
      rm -rf "$(dirname "$DESKTOP_INSTALL")"
      cp -R "$DESKTOP_SOURCE" "$(dirname "$DESKTOP_INSTALL")"
      powershell.exe -NoProfile -Command "\$ws = New-Object -ComObject WScript.Shell; \$paths = @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs')); foreach (\$folder in \$paths) { if (Test-Path \$folder) { \$shortcut = \$ws.CreateShortcut((Join-Path \$folder 'OnethyCode.lnk')); \$shortcut.TargetPath = (Join-Path '$DESKTOP_INSTALL' (Split-Path '$DESKTOP_EXE' -Leaf)); \$shortcut.WorkingDirectory = '$DESKTOP_INSTALL'; \$shortcut.Save() } }"
      echo "OnethyCode desktop installed at: ${DESKTOP_INSTALL}"
    else
      echo "[INFO] Desktop build not found at ${DESKTOP_EXE}; build packages/desktop with OPENCODE_CHANNEL=prod first."
    fi
    ;;
esac

echo "Ensure ${TARGET_DIR} is in your PATH."

