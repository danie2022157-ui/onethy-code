# OnethyCode - Instalador Global para Windows
$ErrorActionPreference = "Stop"
try {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  $OutputEncoding = [System.Text.Encoding]::UTF8
} catch {}

if ([string]::IsNullOrWhiteSpace($PSScriptRoot)) {
  Write-Error "Este instalador precisa ser executado do checkout local. Use git clone, bun install --frozen-lockfile e depois .\\install.ps1."
  exit 1
}
$currentDir = [System.IO.Path]::GetFullPath($PSScriptRoot)
$targetDir = "$env:LOCALAPPDATA\Microsoft\WindowsApps"

# Do not save an invalid checkout into the global launcher. A relocated or
# copied install.ps1 may otherwise create a shortcut that can never start.
$requiredFiles = @(
  "bin\onethy.js",
  "bin\omni-runtime.js",
  "packages\cli\src\index.ts",
  "package.json"
)
foreach ($relative in $requiredFiles) {
  $required = Join-Path $currentDir $relative
  if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
    Write-Host "[ERROR] This is not a complete OnethyCode source checkout: $currentDir" -ForegroundColor Red
    Write-Host "[ERROR] Missing $relative. Run install.ps1 from the repository containing bin\onethy.js." -ForegroundColor Red
    exit 1
  }
}

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  Instalando OnethyCode CLI (onethy / onethy-code) no Windows" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

$nodePath = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $nodePath) {
  Write-Host "[ERRO] Node.js nao foi encontrado no PATH. Instale o Node.js v20+ antes de continuar." -ForegroundColor Red
  exit 1
}

$nodeMajor = & $nodePath -p "Number(process.versions.node.split('.')[0])"
if ($LASTEXITCODE -ne 0 -or [int]$nodeMajor -lt 20) {
  Write-Host "[ERRO] Node.js v20+ e necessario. Versao encontrada: $nodeMajor" -ForegroundColor Red
  exit 1
}

$dependencies = @(
  (Join-Path $currentDir "node_modules"),
  (Join-Path $currentDir "packages\cli\node_modules")
)
if ($dependencies | Where-Object { -not (Test-Path -LiteralPath $_ -PathType Container) }) {
  Write-Host "[ERRO] Dependencias do OnethyCode ausentes. Execute 'bun install' em $currentDir antes de instalar." -ForegroundColor Red
  exit 1
}

if (-not $env:BUN_BIN) {
  $bunCmd = Get-Command bun -ErrorAction SilentlyContinue
  if ($bunCmd) {
    if ($bunCmd.Source.EndsWith(".exe", [System.StringComparison]::OrdinalIgnoreCase)) {
      $env:BUN_BIN = $bunCmd.Source
    } else {
      $npmBun = Join-Path (Split-Path $bunCmd.Source -Parent) "node_modules\bun\bin\bun.exe"
      if (Test-Path -LiteralPath $npmBun -PathType Leaf) {
        $env:BUN_BIN = $npmBun
      }
    }
  }
}
if (-not $env:BUN_BIN -and $env:APPDATA) {
  $globalNpmBun = Join-Path $env:APPDATA "npm\node_modules\bun\bin\bun.exe"
  if (Test-Path -LiteralPath $globalNpmBun -PathType Leaf) {
    $env:BUN_BIN = $globalNpmBun
  }
}

$runtimePath = Join-Path $currentDir "bin\omni-runtime.js"
$resolverScriptPath = Join-Path $env:TEMP "omnicode-resolve-bun-$PID.mjs"
$resolverScript = @'
import { pathToFileURL } from "node:url"
const { findBun } = await import(pathToFileURL(process.argv[2]).href)
const bun = findBun()
if (!bun) process.exitCode = 1
else process.stdout.write(bun)
'@
[System.IO.File]::WriteAllText($resolverScriptPath, $resolverScript, [System.Text.UTF8Encoding]::new($false))
try {
  $bunPath = & $nodePath $resolverScriptPath $runtimePath
  $resolveExitCode = $LASTEXITCODE
} finally {
  Remove-Item -LiteralPath $resolverScriptPath -Force
}
if ($resolveExitCode -ne 0 -or [string]::IsNullOrWhiteSpace($bunPath)) {
  Write-Host "[ERRO] Bun nao foi encontrado. Instale o Bun ou defina BUN_BIN com o caminho absoluto do executavel." -ForegroundColor Red
  exit 1
}

& $bunPath --version *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Host "[ERRO] O executavel Bun resolvido nao pode ser executado: $bunPath" -ForegroundColor Red
  exit 1
}

# A desktop install must never silently continue without a production app.
$desktopAppSource = Join-Path $currentDir "dist\desktop\app"
$desktopExeCandidate = Join-Path $desktopAppSource "OnethyCode.exe"
if (-not (Test-Path -LiteralPath $desktopExeCandidate -PathType Leaf)) {
  $desktopExeCandidate = Join-Path $desktopAppSource "OpenCode.exe"
}
if (-not (Test-Path -LiteralPath $desktopExeCandidate -PathType Leaf)) {
  Write-Host "[OnethyCode] Desktop production build is missing. Building it automatically..." -ForegroundColor Cyan
  $env:BUN_BIN = $bunPath
  try {
    & (Join-Path $currentDir "build-desktop.ps1")
    if ($LASTEXITCODE -ne 0) { throw "build-desktop.ps1 failed with exit code $LASTEXITCODE" }
  } catch {
    Write-Host "[ERRO] Desktop production build failed: $_" -ForegroundColor Red
    Write-Host "[ERRO] Installation stopped. Fix the build error and run .\install.ps1 again." -ForegroundColor Red
    exit 1
  }
  $desktopExeCandidate = Join-Path $desktopAppSource "OnethyCode.exe"
  if (-not (Test-Path -LiteralPath $desktopExeCandidate -PathType Leaf)) {
    $desktopExeCandidate = Join-Path $desktopAppSource "OpenCode.exe"
  }
  if (-not (Test-Path -LiteralPath $desktopExeCandidate -PathType Leaf)) {
    Write-Host "[ERRO] Build finished without OnethyCode.exe or OpenCode.exe in $desktopAppSource" -ForegroundColor Red
    exit 1
  }
}

$onethyCmd = Join-Path $targetDir "onethy.cmd"
$onethyCodeCmd = Join-Path $targetDir "onethy-code.cmd"
$omniCmd = Join-Path $targetDir "omni.cmd"
$omnicodeCmd = Join-Path $targetDir "omnicode.cmd"
$launcherPs1 = Join-Path $targetDir "onethy.ps1"
$launcherMjs = Join-Path $targetDir "onethy-launcher.mjs"
$configPath = Join-Path $targetDir "onethy-config.json"

$cmdContent = @"
@echo off
if exist "$nodePath" (
  "$nodePath" "%~dp0onethy-launcher.mjs" %*
  exit /b %ERRORLEVEL%
)
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0onethy.ps1" %*
exit /b %ERRORLEVEL%
"@
$launcherMjsContent = @'
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = path.dirname(fileURLToPath(import.meta.url))
const configPath = path.join(root, "onethy-config.json")
const required = ["bin/onethy.js", "bin/omni-runtime.js", "packages/cli/src/index.ts", "install.ps1"]

function isCheckout(directory) {
  if (!directory || typeof directory !== "string") return false
  try {
    const full = path.resolve(directory)
    return required.every((relative) => fs.statSync(path.join(full, relative)).isFile())
  } catch {
    return false
  }
}

function findCheckout(savedPath) {
  if (!savedPath || typeof savedPath !== "string") return undefined
  let current = path.resolve(savedPath)
  for (let depth = 0; depth < 8; depth += 1) {
    for (const candidate of [current, path.join(current, "onethy-code")]) {
      if (isCheckout(candidate)) return path.resolve(candidate)
    }
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  return undefined
}

if (!fs.existsSync(configPath)) {
  console.error("[OnethyCode] Missing global launcher configuration. Re-run install.ps1 from the OnethyCode source folder.")
  process.exit(1)
}

let config
try {
  config = JSON.parse(fs.readFileSync(configPath, "utf8").replace(/^\uFEFF/, ""))
} catch {
  console.error("[OnethyCode] Launcher configuration is unreadable. Re-run install.ps1 from the OnethyCode source folder.")
  process.exit(1)
}

let checkout = typeof config?.checkout === "string" ? config.checkout : ""
if (!isCheckout(checkout)) {
  checkout = findCheckout(checkout)
  if (!checkout) {
    console.error("[OnethyCode] The saved checkout path is no longer valid. Open the folder containing bin\\onethy.js and run .\\install.ps1 again.")
    process.exit(1)
  }
  console.log(`[OnethyCode] Repaired stale checkout path: ${checkout}`)
  config.checkout = checkout
  const temporary = `${configPath}.${process.pid}.tmp`
  try {
    fs.writeFileSync(temporary, JSON.stringify(config), "utf8")
    fs.renameSync(temporary, configPath)
  } catch {
    console.error("[OnethyCode] Warning: path repaired for this launch only; re-run install.ps1 to persist it.")
  } finally {
    try {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
    } catch {}
  }
}

await import(pathToFileURL(path.join(checkout, "bin", "onethy.js")).href)
'@
$launcherContent = @'
$ErrorActionPreference = "Stop"
$configPath = Join-Path $PSScriptRoot "onethy-config.json"

function Test-OnethyCheckout([string]$directory) {
  if ([string]::IsNullOrWhiteSpace($directory)) { return $false }
  try {
    $directory = [System.IO.Path]::GetFullPath($directory)
    foreach ($relative in @("bin\onethy.js", "bin\omni-runtime.js", "packages\cli\src\index.ts", "install.ps1")) {
      if (-not (Test-Path -LiteralPath (Join-Path $directory $relative) -PathType Leaf)) {
        return $false
      }
    }
    return $true
  } catch {
    return $false
  }
}

function Find-OnethyCheckout([string]$savedPath) {
  if ([string]::IsNullOrWhiteSpace($savedPath)) { return $null }
  try {
    $current = [System.IO.Path]::GetFullPath($savedPath)
  } catch {
    return $null
  }
  # Repair historical paths such as <root>\onethy-code\onethy-code.
  # Only search around the original configured path; never execute a random
  # onethy-code directory found in the user's current working directory.
  for ($depth = 0; $depth -lt 8; $depth++) {
    foreach ($candidate in @($current, (Join-Path $current "onethy-code"))) {
      if (Test-OnethyCheckout $candidate) {
        return [System.IO.Path]::GetFullPath($candidate)
      }
    }
    $parent = [System.IO.Directory]::GetParent($current)
    if ($null -eq $parent) { break }
    $current = $parent.FullName
  }
  return $null
}

if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) {
  [Console]::Error.WriteLine("[OnethyCode] Missing global launcher configuration. Re-run install.ps1 from the OnethyCode source folder.")
  exit 1
}

try {
  $config = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
} catch {
  [Console]::Error.WriteLine("[OnethyCode] Launcher configuration is unreadable. Re-run install.ps1 from the OnethyCode source folder.")
  exit 1
}

$checkout = [string]$config.checkout
if (-not (Test-OnethyCheckout $checkout)) {
  $checkout = Find-OnethyCheckout $checkout
  if (-not $checkout) {
    [Console]::Error.WriteLine("[OnethyCode] The saved checkout path is no longer valid. Open the folder containing bin\onethy.js and run .\install.ps1 again.")
    exit 1
  }
  [Console]::Out.WriteLine("[OnethyCode] Repaired stale checkout path: $checkout")
  $config.checkout = $checkout
  $temporary = "$configPath.$PID.tmp"
  try {
    $serialized = ConvertTo-Json -InputObject $config -Depth 8 -Compress
    [System.IO.File]::WriteAllText($temporary, $serialized, [System.Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temporary -Destination $configPath -Force
  } catch {
    [Console]::Error.WriteLine("[OnethyCode] Warning: path repaired for this launch only; re-run install.ps1 to persist it.")
  } finally {
    if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
  }
}

$nodePath = [string]$config.nodePath
if (-not $nodePath -or -not (Test-Path -LiteralPath $nodePath -PathType Leaf)) {
  $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
  if (-not $nodeCommand) {
    [Console]::Error.WriteLine("[OnethyCode] Node.js was not found. Reinstall Node.js, then run install.ps1 again.")
    exit 1
  }
  $nodePath = $nodeCommand.Source
}
& $nodePath (Join-Path $checkout "bin\onethy.js") @args
exit $LASTEXITCODE
'@
$configContent = [ordered]@{ nodePath = $nodePath; checkout = $currentDir } | ConvertTo-Json -Compress

New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
Set-Content -Path $launcherPs1 -Value $launcherContent -Encoding ASCII
[System.IO.File]::WriteAllText($launcherMjs, $launcherMjsContent, [System.Text.UTF8Encoding]::new($false))
[System.IO.File]::WriteAllText($configPath, $configContent, [System.Text.UTF8Encoding]::new($false))
Set-Content -Path $onethyCmd -Value $cmdContent -Encoding ASCII
Set-Content -Path $onethyCodeCmd -Value $cmdContent -Encoding ASCII
Set-Content -Path $omniCmd -Value $cmdContent -Encoding ASCII
Set-Content -Path $omnicodeCmd -Value $cmdContent -Encoding ASCII

Write-Host "[OK] Comandos 'onethy', 'onethy-code' e aliases instalados em: $targetDir" -ForegroundColor Green
Write-Host "[OK] Agora voce pode abrir qualquer terminal e digitar 'onethy' diretamente!" -ForegroundColor Green

# Install the verified production desktop build, accepting either executable name.
$desktopInstallRoot = Join-Path $env:LOCALAPPDATA "Programs\OnethyCode"
$desktopInstallApp = Join-Path $desktopInstallRoot "app"
try {
  Remove-Item -LiteralPath $desktopInstallRoot -Recurse -Force -ErrorAction SilentlyContinue
  Copy-Item -LiteralPath $desktopAppSource -Destination $desktopInstallApp -Recurse -Force
  $installedExe = Join-Path $desktopInstallApp (Split-Path -Leaf $desktopExeCandidate)
  if (-not (Test-Path -LiteralPath $installedExe -PathType Leaf)) { throw "Desktop executable was not copied to $installedExe" }
  Write-Host "[OK] Aplicacao desktop de producao instalada em: $desktopInstallRoot" -ForegroundColor Green
  $wsh = New-Object -ComObject WScript.Shell
  $iconPath = Join-Path $currentDir "packages\desktop\resources\icons\icon.ico"
  $shortcutFolders = @(
    [Environment]::GetFolderPath("Desktop"),
    [Environment]::GetFolderPath("Programs")
  ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) -and (Test-Path -LiteralPath $_ -PathType Container) }
  foreach ($folder in $shortcutFolders) {
    $lnkPath = Join-Path $folder "OnethyCode.lnk"
    $shortcut = $wsh.CreateShortcut($lnkPath)
    $shortcut.TargetPath = $installedExe
    $shortcut.WorkingDirectory = $desktopInstallApp
    $shortcut.Description = "OnethyCode — AI Coding Studio Desktop"
    if (Test-Path -LiteralPath $iconPath -PathType Leaf) { $shortcut.IconLocation = "$iconPath,0" }
    else { $shortcut.IconLocation = "$installedExe,0" }
    $shortcut.Save()
  }
  Write-Host "[OK] Atalhos do OnethyCode criados na Area de Trabalho e no Menu Iniciar!" -ForegroundColor Green
} catch {
  Write-Host "[ERRO] Falha ao instalar o desktop: $_" -ForegroundColor Red
  exit 1
}
Write-Host "==========================================================" -ForegroundColor Cyan

# First-install personalization sync. Bun postinstall normally runs BEFORE the
# OnethyCode environment is set, so the bootstrap would otherwise be skipped.
# Never execute third-party scripts or enable MCP servers during this import.
# Explicit opt-out and CI guard keep offline/automated installs deterministic.
if ($env:ONETHY_SKIP_CUSTOMIZATION_SYNC -ne "1" -and $env:GITHUB_ACTIONS -ne "true" -and $env:CI -ne "true") {
  $bootstrap = Join-Path $currentDir "script\onethy-customizations-bootstrap.mjs"
  if (Test-Path -LiteralPath $bootstrap -PathType Leaf) {
    $previousRoot = $env:ONETHY_INSTALL_ROOT
    $previousOmni = $env:OMNICODE_ACTIVE
    $previousOnethy = $env:ONETHY_ACTIVE
    try {
      $env:ONETHY_INSTALL_ROOT = $currentDir
      $env:OMNICODE_ACTIVE = "1"
      $env:ONETHY_ACTIVE = "1"
      Push-Location -LiteralPath $currentDir
      try {
        & $nodePath $bootstrap
        if ($LASTEXITCODE -ne 0) {
          Write-Warning "OnethyCode personalizations were not synchronized. The CLI installation is still usable."
        }
      } finally {
        Pop-Location
      }
    } catch {
      Write-Warning "Unable to synchronize optional personalizations: $_"
    } finally {
      $env:ONETHY_INSTALL_ROOT = $previousRoot
      $env:OMNICODE_ACTIVE = $previousOmni
      $env:ONETHY_ACTIVE = $previousOnethy
    }
  }
}

if ($env:ONETHY_SKIP_PRECOMPILE -ne "1" -and $env:GITHUB_ACTIONS -ne "true" -and $env:CI -ne "true") {
  $precompileScript = Join-Path $currentDir "packages\cli\script\build-local-cache.ts"
  if (Test-Path -LiteralPath $precompileScript -PathType Leaf) {
    Write-Host "[OnethyCode] Pre-compilando bundle rapido do CLI + TUI..." -ForegroundColor Cyan
    try {
      & $bunPath $precompileScript
    } catch {
      Write-Warning "Unable to build optional local CLI cache: $_"
    }
  }
}

