#Requires -Version 5.1
<#
SteamDeals production release helper (used by the steamdeals-release skill).

Reads docs/releases/vX.Y.Z.json (written by steamdeals-build), then drives the
restricted "deploy" account on the server. It never edits the project compose
files: the image tag is injected through an override file on the server.

Usage:
  pwsh -File release.ps1 -Version v2.31.0
  pwsh -File release.ps1 -Version v2.31.0 -DryRun
  pwsh -File release.ps1 -Version v2.31.0 -Targets app,scheduler
  pwsh -File release.ps1 -Rollback
  pwsh -File release.ps1 -Version v2.30.3 -Rollback

Environment overrides:
  STEAMDEALS_HOST     default sd.yyliucha.cn
  STEAMDEALS_SSH_KEY  default %USERPROFILE%\.ssh\id_ed25519_steamdeals
  STEAMDEALS_SITE     default https://sd.yyliucha.cn
#>
param(
  [string]$Version = "",
  [string]$Targets = "",
  [switch]$Rollback,
  [switch]$DryRun,
  [string]$RepoPath = "F:\dsh\gameprice"
)

$ErrorActionPreference = "Stop"

function Write-Step([string]$msg) { Write-Host "== $msg" }
function Fail([string]$msg) { Write-Host "RELEASE_ERROR $msg"; exit 1 }

# ---------- repo / version ----------
if (-not (Test-Path (Join-Path $RepoPath "package.json"))) {
  $root = (& git rev-parse --show-toplevel 2>$null)
  if ($root) { $RepoPath = $root.Trim() }
}
if (-not (Test-Path (Join-Path $RepoPath "package.json"))) { Fail "repo not found: $RepoPath" }

$ver = ""
if ($Version) {
  $ver = $Version.Trim()
  if ($ver.StartsWith("v")) { $ver = $ver.Substring(1) }
}
if (-not $Rollback) {
  if (-not $ver) { Fail "Version is required (e.g. -Version v2.31.0)" }
  if ($ver -notmatch '^\d+\.\d+\.\d+$') { Fail "bad version: $ver" }
}
$tag = if ($ver) { "v$ver" } else { "" }

# ---------- manifest ----------
$manifestPath = ""
$manifest = $null
if ($tag) {
  $manifestPath = Join-Path $RepoPath "docs\releases\$tag.json"
  if (Test-Path $manifestPath) {
    try { $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json } catch { Fail "invalid manifest JSON: $manifestPath" }
  }
}
if ($manifest -and $manifest.version -and ("$($manifest.version)" -ne $ver)) {
  Fail "manifest version '$($manifest.version)' != requested '$ver'"
}

# ---------- targets ----------
$targetList = @()
if ($Targets) {
  $targetList = @($Targets -split '[,; ]+' | Where-Object { $_ })
} elseif ($manifest -and $manifest.targets) {
  $targetList = @($manifest.targets)
}
if (-not $targetList -or $targetList.Count -eq 0) { $targetList = @("app") }
$targetList = @($targetList | Where-Object { $_ -eq "app" -or $_ -eq "scheduler" } | Select-Object -Unique)
if ($targetList.Count -eq 0) { Fail "targets must be app and/or scheduler" }

# ---------- ssh ----------
$sshKey = $env:STEAMDEALS_SSH_KEY
if (-not $sshKey) { $sshKey = Join-Path $env:USERPROFILE ".ssh\id_ed25519_steamdeals" }
if (-not (Test-Path $sshKey)) { Fail "SSH key not found: $sshKey" }
$hostName = $env:STEAMDEALS_HOST
if (-not $hostName) { $hostName = "sd.yyliucha.cn" }
$siteBase = $env:STEAMDEALS_SITE
if (-not $siteBase) { $siteBase = "https://sd.yyliucha.cn" }
$remote = "deploy@$hostName"

function Invoke-Remote([string]$verb) {
  $out = & ssh -i $sshKey -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 $remote $verb 2>&1
  $code = $LASTEXITCODE
  [pscustomobject]@{ Output = (($out | Out-String).Trim()); Code = $code }
}

# ---------- gates ----------
Write-Step "gate: online status"
$st = Invoke-Remote "status"
if ($st.Code -ne 0) { Fail "status failed: $($st.Output)" }
if ($st.Output -notmatch "healthy") { Fail "app is not healthy:`n$($st.Output)" }

Write-Step "gate: current version"
$cur = Invoke-Remote "version"
if ($cur.Code -ne 0) { Fail "version failed: $($cur.Output)" }
$curVer = $cur.Output.Trim()

if (-not $Rollback) {
  Write-Step "gate: tag $tag"
  $tagOut = (& git -C $RepoPath tag -l $tag)
  if (-not $tagOut) { Fail "tag $tag not found in repo" }

  if ($manifest -and $manifest.ci) {
    if ("$($manifest.ci.docker_hub)" -ne "success" -or "$($manifest.ci.docker_tcr)" -ne "success") {
      Fail "CI not both green in manifest (docker_hub=$($manifest.ci.docker_hub), docker_tcr=$($manifest.ci.docker_tcr))"
    }
  } else {
    Write-Host "WARN: manifest missing CI fields, verify CI manually before deploying"
  }

  if ($curVer -eq $ver -and -not $DryRun) {
    Fail "online already $ver; use 'deploy $tag --force' on the server for an intentional re-release"
  }
}

if ($DryRun) {
  Write-Host "PLAN version=$ver tag=$tag targets=$($targetList -join ',') current=$curVer host=$hostName manifest=$manifestPath"
  exit 0
}

# ---------- rollback ----------
if ($Rollback) {
  $verb = if ($tag) { "rollback $tag" } else { "rollback" }
  Write-Step $verb
  $r = Invoke-Remote $verb
  Write-Host $r.Output
  if ($r.Code -ne 0) { Fail "rollback failed" }
  $siteVer = ""
  try { $siteVer = (Invoke-RestMethod "$siteBase/api/site" -TimeoutSec 10).version } catch { $siteVer = "" }
  Write-Host ("ROLLBACK_OK " + ([ordered]@{ version = "$ver"; siteVersion = $siteVer; status = "rolled-back" } | ConvertTo-Json -Compress))
  exit 0
}

# ---------- deploy ----------
if ($targetList -contains "app") {
  Write-Step "deploy app $tag"
  $r = Invoke-Remote "deploy $tag"
  Write-Host $r.Output
  if ($r.Code -ne 0) { Fail "app deploy failed (server auto-rollback attempted, see output above)" }
}
if ($targetList -contains "scheduler") {
  Write-Step "deploy scheduler $tag"
  $r = Invoke-Remote "deploy-scheduler $tag"
  Write-Host $r.Output
  if ($r.Code -ne 0) { Fail "scheduler deploy failed" }
}

# ---------- verify ----------
Write-Step "verify: site version"
$siteVer = ""
for ($i = 0; $i -lt 12; $i++) {
  try { $siteVer = (Invoke-RestMethod "$siteBase/api/site" -TimeoutSec 10).version } catch { $siteVer = "" }
  if ($siteVer -eq $ver) { break }
  Start-Sleep -Seconds 5
}
if ($siteVer -ne $ver) { Fail "site version is '$siteVer', expected '$ver'" }

Write-Step "verify: self check"
$c = Invoke-Remote "check"
$tail = ($c.Output -split "`n" | Select-Object -Last 8) -join "`n"
Write-Host $tail
if ($c.Code -ne 0) { Fail "check command failed" }

Write-Step "verify: public smoke"
try {
  $null = Invoke-WebRequest "$siteBase/" -TimeoutSec 15 -UseBasicParsing
  $null = Invoke-WebRequest "$siteBase/login" -TimeoutSec 15 -UseBasicParsing
  $search = Invoke-RestMethod "$siteBase/api/games/search" -Method Post -ContentType "application/json" -Body '{"page":1,"pageSize":1,"region":"cn"}' -TimeoutSec 15
} catch { Fail "public smoke failed: $($_.Exception.Message)" }
Write-Host "smoke: home/login 200, search total=$($search.total)"

# ---------- write back manifest ----------
if ($manifestPath -and (Test-Path $manifestPath)) {
  $m = Get-Content $manifestPath -Raw | ConvertFrom-Json
  $rel = [pscustomobject]@{
    status       = "success"
    releasedAt   = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    by           = "steamdeals-release"
    targets      = $targetList
    previous     = $curVer
    siteVersion  = $siteVer
  }
  $m | Add-Member -NotePropertyName release -NotePropertyValue $rel -Force
  $json = $m | ConvertTo-Json -Depth 8
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($manifestPath, $json, $utf8)
  Write-Host "manifest updated: $manifestPath"
}

$result = [ordered]@{
  version     = $ver
  tag         = $tag
  targets     = $targetList
  previous    = $curVer
  siteVersion = $siteVer
  status      = "success"
}
Write-Host ("RELEASE_OK " + ($result | ConvertTo-Json -Compress))
