# OmniCode — Instalador Global para Windows
$ErrorActionPreference = "Stop"

$currentDir = $PSScriptRoot
$targetDir = "$env:LOCALAPPDATA\Microsoft\WindowsApps"

Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "  Instalando OmniCode CLI (omni / omnicode) no Windows" -ForegroundColor Cyan
Write-Host "======================================================" -ForegroundColor Cyan

$nodePath = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $nodePath) {
  Write-Host "[ERRO] Node.js não foi encontrado no PATH. Instale o Node.js v20+ antes de continuar." -ForegroundColor Red
  exit 1
}

$nodeMajor = & $nodePath -p "Number(process.versions.node.split('.')[0])"
if ($LASTEXITCODE -ne 0 -or [int]$nodeMajor -lt 20) {
  Write-Host "[ERRO] Node.js v20+ é necessário. Versão encontrada: $nodeMajor" -ForegroundColor Red
  exit 1
}

$dependencies = @(
  (Join-Path $currentDir "node_modules"),
  (Join-Path $currentDir "packages\cli\node_modules")
)
if ($dependencies | Where-Object { -not (Test-Path -LiteralPath $_ -PathType Container) }) {
  Write-Host "[ERRO] Dependências do OmniCode ausentes. Execute 'bun install' em $currentDir antes de instalar." -ForegroundColor Red
  exit 1
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
  Write-Host "[ERRO] Bun não foi encontrado. Instale o Bun ou defina BUN_BIN com o caminho absoluto do executável." -ForegroundColor Red
  exit 1
}

& $bunPath --version *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Host "[ERRO] O executável Bun resolvido não pôde ser executado: $bunPath" -ForegroundColor Red
  exit 1
}

$omniCmd = Join-Path $targetDir "omni.cmd"
$omnicodeCmd = Join-Path $targetDir "omnicode.cmd"
$launcherPs1 = Join-Path $targetDir "omni.ps1"
$configPath = Join-Path $targetDir "omni-config.json"

$cmdContent = @"
@echo off
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0omni.ps1" %*
exit /b %ERRORLEVEL%
"@
$launcherContent = @'
$ErrorActionPreference = "Stop"
$config = Get-Content -LiteralPath (Join-Path $PSScriptRoot "omni-config.json") -Raw -Encoding UTF8 | ConvertFrom-Json
& $config.nodePath (Join-Path $config.checkout "bin\omni.js") @args
exit $LASTEXITCODE
'@
$configContent = [ordered]@{ nodePath = $nodePath; checkout = $currentDir } | ConvertTo-Json -Compress

New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
Set-Content -Path $launcherPs1 -Value $launcherContent -Encoding ASCII
[System.IO.File]::WriteAllText($configPath, $configContent, [System.Text.UTF8Encoding]::new($false))
Set-Content -Path $omniCmd -Value $cmdContent -Encoding ASCII
Set-Content -Path $omnicodeCmd -Value $cmdContent -Encoding ASCII

Write-Host "[OK] Atalhos de desenvolvimento 'omni' e 'omnicode' instalados em: $targetDir" -ForegroundColor Green
Write-Host "[AVISO] Eles apontam para este checkout; mantenha o checkout e suas dependências disponíveis." -ForegroundColor Yellow
Write-Host "[AVISO] Ainda não há canal de atualização independente do OmniCode; atualize este checkout manualmente." -ForegroundColor Yellow
Write-Host "[OK] Agora você pode abrir qualquer terminal e digitar 'omni' diretamente!" -ForegroundColor Green
Write-Host "======================================================" -ForegroundColor Cyan

