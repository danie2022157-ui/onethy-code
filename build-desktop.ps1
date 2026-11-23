# OnethyCode - deterministic Windows production desktop build
$ErrorActionPreference = "Stop"

$repoRoot = [System.IO.Path]::GetFullPath($PSScriptRoot)
$bunPath = $env:BUN_BIN
if ([string]::IsNullOrWhiteSpace($bunPath) -or -not (Test-Path -LiteralPath $bunPath -PathType Leaf)) {
  $bunCommand = Get-Command bun -ErrorAction SilentlyContinue
  if (-not $bunCommand) { throw "Bun was not found. Install Bun or set BUN_BIN to bun.exe." }
  $bunPath = $bunCommand.Source
}

$previousChannel = $env:OPENCODE_CHANNEL
$previousTarget = $env:OPENCODE_TARGET
$previousDesktopApp = $env:OPENCODE_DESKTOP_APP
try {
  $env:OPENCODE_CHANNEL = "prod"
  $env:OPENCODE_DESKTOP_APP = $null
  $bunArch = (& $bunPath -p "process.arch").Trim()
  if ($LASTEXITCODE -ne 0) { throw "Could not detect Bun architecture." }
  if ($bunArch -eq "arm64") { $env:OPENCODE_TARGET = "windows-arm64" }
  else { $env:OPENCODE_TARGET = "windows-x64" }

  Push-Location -LiteralPath $repoRoot
  try {
    Write-Host "[1/2] Building production desktop (the CLI prerequisite is built automatically if missing)..." -ForegroundColor Cyan
    & $bunPath run --cwd packages/desktop build
    if ($LASTEXITCODE -ne 0) { throw "Desktop build failed with exit code $LASTEXITCODE." }

    Write-Host "[2/2] Packaging Windows desktop app..." -ForegroundColor Cyan
    & $bunPath run --cwd packages/desktop pack
    if ($LASTEXITCODE -ne 0) { throw "Desktop packaging failed with exit code $LASTEXITCODE." }

    $appDir = Join-Path $repoRoot "dist\desktop\app"
    $exe = @("OnethyCode.exe", "OpenCode.exe") | ForEach-Object { Join-Path $appDir $_ } | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
    if (-not $exe) { throw "Packaging completed but no OnethyCode.exe/OpenCode.exe exists in $appDir." }
    Write-Host "[OK] Production desktop ready: $exe" -ForegroundColor Green
  } finally {
    Pop-Location
  }
} finally {
  $env:OPENCODE_CHANNEL = $previousChannel
  $env:OPENCODE_TARGET = $previousTarget
  $env:OPENCODE_DESKTOP_APP = $previousDesktopApp
}