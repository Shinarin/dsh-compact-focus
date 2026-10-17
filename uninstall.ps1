# Remove dsh-compact-focus from the DSH desktop profile.
#
#   pwsh -File .\uninstall.ps1
#
# Restart DSH desktop afterwards to return to the shipped /compact.
$ErrorActionPreference = 'Stop'

$pluginDir = $PSScriptRoot
$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$profileName = if ($env:DSH_PROFILE) { $env:DSH_PROFILE } else { 'desktop' }
$profileDir = if ($env:DSH_PROFILE_DIR) { $env:DSH_PROFILE_DIR } else { Join-Path (Join-Path $dshHome 'profiles') $profileName }

$pkgPath = Join-Path $profileDir 'package.json'
if (-not (Test-Path $pkgPath)) { throw "DSH profile not found: $pkgPath" }

Copy-Item $pkgPath "$pkgPath.dsh-compact-focus.uninstall.bak" -Force
$pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json
if ($null -ne $pkg.dependencies) { $pkg.dependencies.PSObject.Properties.Remove('dsh-compact-focus') }
if ($null -ne $pkg.dsh -and $null -ne $pkg.dsh.profile -and $null -ne $pkg.dsh.profile.bundles) {
  $pkg.dsh.profile.bundles = @($pkg.dsh.profile.bundles | Where-Object { $_ -ne 'dsh-compact-focus' })
}
$json = $pkg | ConvertTo-Json -Depth 20
[System.IO.File]::WriteAllText($pkgPath, $json, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "manifest: $pkgPath"

$linkPath = Join-Path $profileDir 'node_modules\dsh-compact-focus'
if (Test-Path $linkPath) {
  $item = Get-Item $linkPath -Force
  $isReparse = [bool]($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint)
  if ($isReparse) {
    [System.IO.Directory]::Delete($linkPath)
    Write-Host "removed link: $linkPath"
  } else {
    Write-Warning "$linkPath is not a link; left in place for manual review"
  }
}

Write-Host ''
Write-Host 'Uninstalled. Fully quit and restart DeepSeek Harness.'
