# OnethyCode — Windows complete uninstaller (runs without the OnethyCode CLI/TUI).
# This script deliberately does NOT uninstall Node.js, Bun, Git, OpenCode or remote GitHub repositories.
param(
  [Parameter(Mandatory = $true)][string]$Checkout,
  [int]$ChildPid = 0,
  [int]$ParentPid = 0,
  [switch]$Yes,
  [switch]$Preview,
  [switch]$KeepWindow
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$errors = New-Object 'System.Collections.Generic.List[string]'
$warnings = New-Object 'System.Collections.Generic.List[string]'

function FullPath([string]$value) {
  return [System.IO.Path]::GetFullPath($value).TrimEnd('\')
}
function Inside([string]$parent, [string]$child) {
  return $child.StartsWith(($parent.TrimEnd('\') + '\'), [StringComparison]::OrdinalIgnoreCase)
}
function SafeRoot([string]$name, [string]$candidate, [string]$profileRoot) {
  if ([string]::IsNullOrWhiteSpace($candidate)) { return $null }
  $resolved = FullPath $candidate
  if (-not (Inside $profileRoot $resolved)) {
    $warnings.Add("Ignorando $name fora da pasta do usuario: $resolved")
    return $null
  }
  if ([IO.Path]::GetFileName($resolved) -ine 'omnicode') {
    $warnings.Add("Ignorando ${name}: o diretorio nao termina em omnicode: $resolved")
    return $null
  }
  if ((Test-Path -LiteralPath $resolved) -and ((Get-Item -LiteralPath $resolved -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    $warnings.Add("Ignorando ${name}: link/reparse point: $resolved")
    return $null
  }
  return $resolved
}

try {
  if (-not $env:USERPROFILE -or -not $env:LOCALAPPDATA -or -not $env:APPDATA) {
    throw 'Variaveis de perfil Windows ausentes. Nenhum arquivo sera apagado.'
  }
  $profileRoot = FullPath $env:USERPROFILE
  $root = FullPath $Checkout
  if (-not (Inside $profileRoot $root)) { throw 'A pasta do OnethyCode deve estar dentro da pasta do usuario.' }
  if ([IO.Path]::GetFileName($root) -notmatch '^onethy[-_]?code(?:[-_].*)?$') {
    throw 'Pasta de instalacao nao reconhecida como OnethyCode.'
  }
  if (-not (Test-Path -LiteralPath $root -PathType Container)) {
    throw "Pasta de instalacao inexistente: $root"
  }
  if (((Get-Item -LiteralPath $root -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    throw 'Recusado: a pasta de instalacao e um symlink ou junction.'
  }
  if (-not (Test-Path -LiteralPath (Join-Path $root 'install.ps1') -PathType Leaf) -or
      -not (Test-Path -LiteralPath (Join-Path $root 'bin\onethy.js') -PathType Leaf)) {
    throw 'O diretorio nao contem os marcadores do projeto OnethyCode. Nenhum arquivo sera apagado.'
  }
  $localData = SafeRoot 'dados locais' (Join-Path $env:LOCALAPPDATA 'omnicode') $profileRoot
  $roamingData = SafeRoot 'configuracao' (Join-Path $env:APPDATA 'omnicode') $profileRoot

  # Verify launchers that this checkout actually installed (never delete a
  # different program's command, even if it has the same filename).
  $windowsApps = Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps'
  $configFile = Join-Path $windowsApps 'onethy-config.json'
  $psLauncher = Join-Path $windowsApps 'onethy.ps1'
  $ownedLaunchers = New-Object 'System.Collections.Generic.List[string]'
  if ((Test-Path -LiteralPath $configFile -PathType Leaf) -and (Test-Path -LiteralPath $psLauncher -PathType Leaf)) {
    $config = Get-Content -LiteralPath $configFile -Raw | ConvertFrom-Json
    $psContent = Get-Content -LiteralPath $psLauncher -Raw
    if ($null -ne $config.checkout -and
        (FullPath ([string]$config.checkout)) -ieq $root -and
        $psContent.Contains('onethy-config.json') -and $psContent.Contains('bin\onethy.js')) {
      foreach ($name in @('onethy.cmd', 'onethy-code.cmd', 'omni.cmd', 'omnicode.cmd')) {
        $file = Join-Path $windowsApps $name
        if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { continue }
        $contents = Get-Content -LiteralPath $file -Raw
        if ($contents.Contains('"%~dp0onethy.ps1" %*') -and $contents.Contains('WindowsPowerShell')) {
          $ownedLaunchers.Add($file)
        } else {
          $warnings.Add("Preservando comando nao reconhecido: $file")
        }
      }
      $ownedLaunchers.Add($psLauncher)
      $ownedLaunchers.Add($configFile)
    } else {
      $warnings.Add('Registro global nao corresponde ao OnethyCode desta pasta. Atalhos preservados.')
    }
  } else {
    $warnings.Add('Registro global nao encontrado. Pode ter sido removido anteriormente.')
  }

  $targets = @()
  if ($localData) { $targets += $localData }
  if ($roamingData) { $targets += $roamingData }
  foreach ($launcherFile in $ownedLaunchers) { $targets += $launcherFile }
  $targets += $root

  Write-Host 'Desinstalador completo do OnethyCode' -ForegroundColor Cyan
  Write-Host 'Arquivos/pastas a remover:' -ForegroundColor Yellow
  foreach ($target in $targets) { Write-Host "  $target" }
  Write-Host 'O repositorio remoto GitHub, Node.js, Bun e projetos externos serao preservados.'
  foreach ($warning in $warnings) { Write-Warning $warning }
  if ($Preview) {
    Write-Host 'PREVIEW: nenhuma exclusao realizada.' -ForegroundColor Green
    return
  }
  if (-not $Yes) {
    $answer = Read-Host 'Para APAGAR tudo acima, digite EXCLUIR'
    if ($answer -cne 'EXCLUIR') {
      Write-Host 'Operacao cancelada. Nada foi excluido.'
      return
    }
  }

  $deadline = (Get-Date).AddSeconds(45)
  foreach ($waitFor in @($ChildPid, $ParentPid)) {
    if ($waitFor -le 0 -or $waitFor -eq $PID) { continue }
    while (Get-Process -Id $waitFor -ErrorAction SilentlyContinue) {
      if ((Get-Date) -gt $deadline) {
        throw "Timeout aguardando processo $waitFor. Nenhum arquivo foi excluido."
      }
      Start-Sleep -Milliseconds 250
    }
  }
  Set-Location -LiteralPath $profileRoot

  # Delete app-specific data before the source tree; unrelated global tools stay.
  foreach ($target in $targets) {
    if (-not (Test-Path -LiteralPath $target)) { continue }
    try {
      Write-Host "Excluindo: $target"
      $success = $false
      for ($attempt = 1; $attempt -le 15; $attempt++) {
        try {
          Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction Stop
          $success = $true
          break
        } catch {
          if ($attempt -eq 15) { throw }
          Start-Sleep -Milliseconds 400
        }
      }
      if (-not $success -or (Test-Path -LiteralPath $target)) {
        throw "Ainda existe: $target"
      }
    } catch {
      $errors.Add("$target : $($_.Exception.Message)")
      Write-Warning "Nao foi possivel excluir $target"
    }
  }
  if ($errors.Count -gt 0) {
    Write-Host 'Desinstalacao INCOMPLETA:' -ForegroundColor Red
    foreach ($item in $errors) { Write-Host "  $item" -ForegroundColor Red }
    exit 1
  }
  Write-Host 'OnethyCode removido. Confirme que a pasta e os comandos nao existem mais.' -ForegroundColor Green
} catch {
  Write-Host ('Desinstalacao interrompida: ' + $_.Exception.Message) -ForegroundColor Red
  exit 1
} finally {
  if ($KeepWindow) { Read-Host 'Pressione Enter para fechar' | Out-Null }
}
