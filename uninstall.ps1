# OnethyCode - Safe Windows uninstaller
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$windowsApps = Join-Path $env:LOCALAPPDATA "Microsoft\WindowsApps"
$desktopRoot = Join-Path $env:LOCALAPPDATA "Programs\OnethyCode"
$desktopFolder = [Environment]::GetFolderPath("Desktop")
$startMenu = [Environment]::GetFolderPath("Programs")

# Remove only launcher files owned by install.ps1. Do not remove the whole
# WindowsApps directory or user configuration/data stored elsewhere.
$launcherNames = @(
  "onethy.cmd",
  "onethy-code.cmd",
  "omni.cmd",
  "omnicode.cmd",
  "onethy.ps1",
  "onethy-launcher.mjs",
  "onethy-config.json"
)

$targets = @()
foreach ($name in $launcherNames) {
  $targets += Join-Path $windowsApps $name
}
foreach ($folder in @($desktopFolder, $startMenu)) {
  if (-not [string]::IsNullOrWhiteSpace($folder)) {
    $targets += Join-Path $folder "OnethyCode.lnk"
    $targets += Join-Path $folder "OnethyCode Dev.lnk"
    $targets += Join-Path $folder "OnethyCode.exe.lnk"
    $targets += Join-Path $folder "OnethyCode Dev.exe.lnk"
  }
}

Write-Host "This removes the OnethyCode launchers from WindowsApps, the installed desktop app, and its shortcuts."
Write-Host "It does not delete your cloned source checkout, user configuration, memory, projects, or credentials."
$confirmation = Read-Host "Type UNINSTALL to continue"
if ($confirmation -cne "UNINSTALL") {
  Write-Host "Cancelled. No files were removed."
  exit 0
}

$failures = @()
foreach ($target in $targets) {
  if (Test-Path -LiteralPath $target -PathType Leaf) {
    try {
      Remove-Item -LiteralPath $target -Force
      Write-Host "[OK] Removed $target"
    } catch {
      $failures += "$target : $_"
    }
  }
}

if (Test-Path -LiteralPath $desktopRoot -PathType Container) {
  try {
    Remove-Item -LiteralPath $desktopRoot -Recurse -Force
    Write-Host "[OK] Removed $desktopRoot"
  } catch {
    $failures += "$desktopRoot : $_"
  }
}

if ($failures.Count -gt 0) {
  Write-Host "Some items could not be removed. Close OnethyCode and retry:" -ForegroundColor Yellow
  $failures | ForEach-Object { Write-Host "[!] $_" -ForegroundColor Yellow }
  exit 1
}

Write-Host "OnethyCode launchers and installed desktop app have been removed."
