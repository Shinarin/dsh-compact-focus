# Install dsh-compact-focus into the DSH desktop profile.
#
#   pwsh -File .\install.ps1
#
# Idempotent: re-running repairs the checkout peer link, the bundle link, the
# dependency entry and the bundle entry. Restart DSH desktop afterwards.
$ErrorActionPreference = 'Stop'

$pluginDir = $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($pluginDir)) { throw 'install.ps1 must be run from its own directory' }
if (-not (Test-Path (Join-Path $pluginDir 'package.json'))) { throw "package.json not found beside install.ps1: $pluginDir" }

$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$profileName = if ($env:DSH_PROFILE) { $env:DSH_PROFILE } else { 'desktop' }
$profileDir = if ($env:DSH_PROFILE_DIR) { $env:DSH_PROFILE_DIR } else { Join-Path (Join-Path $dshHome 'profiles') $profileName }

$pkgPath = Join-Path $profileDir 'package.json'
if (-not (Test-Path $pkgPath)) { throw "DSH profile not found: $pkgPath" }

# 1. Peer resolution for the checkout.
#    The Host resolves a bundle through the profile, but Node resolves that
#    bundle's own bare imports from its *physical* location — this directory for
#    a link: install. So the @deepseek-ai packages the Host supplies must resolve
#    from here as well; otherwise every row fails with ERR_MODULE_NOT_FOUND and
#    DSH starts without the plugin (installed, but nothing happens).
$peerStore = Join-Path (Join-Path $dshHome 'profiles') 'node_modules\@deepseek-ai'
if (-not (Test-Path $peerStore)) {
  throw "peer store not found: $peerStore`nThe checkout needs the @deepseek-ai packages that installed bundles resolve their peers from. Install any DSH bundle through 'dsh plugin' on this machine first, then re-run."
}
$peerLink = Join-Path (Join-Path $pluginDir 'node_modules') '@deepseek-ai'
$requiredPeers = @('cordis', 'dsh-commands', 'dsh-compaction', 'dsh-compaction-basic')
if (Test-Path $peerLink) {
  $peerItem = Get-Item $peerLink -Force
  $peerIsReparse = [bool]($peerItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint)
  if ($peerIsReparse) {
    [System.IO.Directory]::Delete($peerLink)
  } else {
    foreach ($peer in $requiredPeers) {
      if (-not (Test-Path (Join-Path $peerLink (Join-Path $peer 'package.json')))) {
        throw "$peerLink exists but does not provide @deepseek-ai/$peer; remove it and re-run"
      }
    }
  }
}
if (-not (Test-Path $peerLink)) {
  $peerParent = Split-Path -Parent $peerLink
  if (-not (Test-Path $peerParent)) { New-Item -ItemType Directory -Path $peerParent | Out-Null }
  New-Item -ItemType Junction -Path $peerLink -Target $peerStore | Out-Null
  Write-Host "peers:  $peerLink -> $peerStore"
}

# 2. Bundle link: profile node_modules/dsh-compact-focus -> this directory.
$nodeModules = Join-Path $profileDir 'node_modules'
if (-not (Test-Path $nodeModules)) { New-Item -ItemType Directory -Path $nodeModules | Out-Null }
$bundleLink = Join-Path $nodeModules 'dsh-compact-focus'
if (Test-Path $bundleLink) {
  $item = Get-Item $bundleLink -Force
  $isReparse = [bool]($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint)
  if (-not $isReparse) { throw "$bundleLink exists and is not a link; remove it manually after checking its contents" }
  [System.IO.Directory]::Delete($bundleLink)
}
New-Item -ItemType Junction -Path $bundleLink -Target $pluginDir | Out-Null
Write-Host "link:   $bundleLink -> $pluginDir"

# 3 + 4. Profile manifest: link dependency and bundle entry.
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

# 5. Load verification: import both rows exactly the way the Host loader does.
#    A failure here means DSH would start without the plugin, so install fails
#    instead of leaving a silent no-op behind.
if ($null -eq (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Warning 'node not found on PATH; skipped load verification. Run: node --expose-internals tools/check-install.mjs'
} else {
  $env:DSH_HOME = $dshHome
  $env:DSH_PROFILE = $profileName
  $env:DSH_PROFILE_DIR = $profileDir
  & node --expose-internals (Join-Path $pluginDir 'tools\check-install.mjs')
  if ($LASTEXITCODE -ne 0) {
    throw 'load verification failed; DSH would start without this plugin. Fix the peer link above, then re-run.'
  }
}

Write-Host ''
Write-Host 'Installed. Fully quit and restart DeepSeek Harness, then use: /compact <重点>'
Write-Host 'Example: /compact 重点总结项目框架'
