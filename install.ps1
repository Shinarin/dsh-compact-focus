# Install dsh-compact-focus into the DSH desktop profile.
#
#   pwsh -File .\install.ps1
#
# Idempotent: re-running repairs the link, dependency entry and bundle entry.
# Restart DSH desktop afterwards.
$ErrorActionPreference = 'Stop'

$pluginDir = $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($pluginDir)) { throw 'install.ps1 must be run from its own directory' }
if (-not (Test-Path (Join-Path $pluginDir 'package.json'))) { throw "package.json not found beside install.ps1: $pluginDir" }

$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$profileName = if ($env:DSH_PROFILE) { $env:DSH_PROFILE } else { 'desktop' }
$profileDir = if ($env:DSH_PROFILE_DIR) { $env:DSH_PROFILE_DIR } else { Join-Path (Join-Path $dshHome 'profiles') $profileName }

$pkgPath = Join-Path $profileDir 'package.json'
if (-not (Test-Path $pkgPath)) { throw "DSH profile not found: $pkgPath" }

# 1. Junction: profile node_modules/dsh-compact-focus -> this directory.
$nodeModules = Join-Path $profileDir 'node_modules'
if (-not (Test-Path $nodeModules)) { New-Item -ItemType Directory -Path $nodeModules | Out-Null }
$linkPath = Join-Path $nodeModules 'dsh-compact-focus'
if (Test-Path $linkPath) {
  $item = Get-Item $linkPath -Force
  $isReparse = [bool]($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint)
  if (-not $isReparse) { throw "$linkPath exists and is not a link; remove it manually after checking its contents" }
  [System.IO.Directory]::Delete($linkPath)
}
New-Item -ItemType Junction -Path $linkPath -Target $pluginDir | Out-Null
Write-Host "link:   $linkPath -> $pluginDir"

# 2 + 3. Profile manifest: link dependency and bundle entry.
Copy-Item $pkgPath "$pkgPath.dsh-compact-focus.bak" -Force
$pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json
if ($null -eq $pkg.dependencies) { $pkg | Add-Member -NotePropertyName dependencies -NotePropertyValue ([pscustomobject]@{}) }
$linkSpec = 'link:' + ($pluginDir -replace '\\', '/')
$pkg.dependencies | Add-Member -NotePropertyName 'dsh-compact-focus' -NotePropertyValue $linkSpec -Force
if ($null -eq $pkg.dsh -or $null -eq $pkg.dsh.profile -or $null -eq $pkg.dsh.profile.bundles) {
  throw 'unexpected profile manifest shape: dsh.profile.bundles is missing'
}
$bundles = [System.Collections.ArrayList]@($pkg.dsh.profile.bundles)
if (-not $bundles.Contains('dsh-compact-focus')) { $null = $bundles.Add('dsh-compact-focus') }
$pkg.dsh.profile.bundles = @($bundles)
$json = $pkg | ConvertTo-Json -Depth 20
[System.IO.File]::WriteAllText($pkgPath, $json, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "manifest: $pkgPath (backup: $pkgPath.dsh-compact-focus.bak)"

Write-Host ''
Write-Host 'Installed. Fully quit and restart DeepSeek Harness, then use: /compact <重点>'
Write-Host 'Example: /compact 重点总结项目框架'
