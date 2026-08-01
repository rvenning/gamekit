<#
.SYNOPSIS
  Publish firestore.rules to the family Firebase project, and prove it landed.

.DESCRIPTION
  Shipping a new game needs one string added to the collection allowlist in
  firestore.rules. That is a two-minute job that has repeatedly turned into a
  twenty-minute one, for a reason worth writing down:

  The Firebase CLI authenticates a service account through exactly one channel,
  the GOOGLE_APPLICATION_CREDENTIALS environment variable. Claude Code's
  .claude/settings.local.json declares that variable and it has never actually
  arrived in the shell - verified empty in both PowerShell and Bash on the
  turret-town ship and again on ricochet-spire, with the same settings file
  parsing cleanly and its permission rules working. So the credential has to
  come from somewhere that does not depend on that mechanism.

  This script is that somewhere. It finds the key by its known path, runs from
  the right directory whatever the caller's cwd is, and then PROBES the live
  project afterwards - because a deploy can silently not happen (wrong cwd, an
  error scrolled off the top, a command that was never really run) and the only
  symptom is a game that quietly runs local-only for weeks.

  NOTE FOR ANYONE EDITING THIS FILE: keep it pure ASCII. Windows PowerShell 5.1
  reads a .ps1 with no BOM as ANSI, so a UTF-8 em-dash arrives as three
  characters - one of which is a double quote. That silently unbalances every
  string after it and the whole script fails to parse. Use "-" and "->".

.PARAMETER Probe
  Skip the deploy; only check which collections the LIVE ruleset allows. Needs
  no credential, so it is safe to run any time.

.PARAMETER DryRun
  Show the ruleset that would be published and stop.

.EXAMPLE
  .\tools\deploy-rules.ps1 -Probe
  .\tools\deploy-rules.ps1 -DryRun
  .\tools\deploy-rules.ps1
#>
[CmdletBinding()]
param(
  [switch]$Probe,
  [switch]$DryRun,
  [string]$KeyPath,
  [string]$Project = "wordvoyage-e5a5c"
)

$ErrorActionPreference = "Stop"

# The web API key is a public client config (referrer-restricted), not a secret.
# It is in every game's js/firebase-config.js and is only used for the probe.
$ApiKey  = "AIzaSyD1h2aN_9spXt8usZ_ycpGFnIIGztESXWk"
$Referer = "https://rvenning.github.io/"

$GamekitDir = Split-Path -Parent $PSScriptRoot
$RulesFile  = Join-Path $GamekitDir "firestore.rules"

function Get-AllowedCollections {
  param([string]$Path)
  $text = Get-Content -Raw -Encoding UTF8 $Path
  if ($text -notmatch '(?s)collection\s+in\s+\[(.*?)\]') { return @() }
  return ([regex]::Matches($Matches[1], '"([^"]+)"') | ForEach-Object { $_.Groups[1].Value })
}

function Test-LiveCollections {
  param([string[]]$Names)
  Write-Host ""
  Write-Host "Probing the LIVE ruleset with one anonymous token..." -ForegroundColor Cyan
  $hdr = @{ Referer = $Referer }
  try {
    $auth = Invoke-RestMethod -Method Post -ContentType "application/json" `
      -Uri "https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=$ApiKey" `
      -Headers $hdr -Body '{"returnSecureToken":true}'
  } catch {
    Write-Host "  anonymous sign-in failed: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "  (the API key is referrer-restricted, so this must send the games' Referer)"
    return $false
  }
  $h = @{ Referer = $Referer; Authorization = "Bearer $($auth.idToken)" }

  # A made-up name is the control. Without it "denied" is ambiguous: it could
  # equally mean the probe itself is broken.
  $control = "definitelynotreal__control"
  $checks = @($Names) + @($control)
  $result = @{}
  foreach ($c in $checks) {
    $uri = "https://firestore.googleapis.com/v1/projects/$Project/databases/(default)/documents/$c" + "?pageSize=1&key=$ApiKey"
    try { Invoke-RestMethod -Uri $uri -Headers $h | Out-Null; $result[$c] = $true }
    catch { $result[$c] = $false }
  }

  if ($result[$control]) {
    Write-Host "  A MADE-UP COLLECTION WAS ALLOWED - the ruleset is wide open. Stop and look." -ForegroundColor Red
    return $false
  }

  $ok = $true
  foreach ($c in $Names) {
    if ($result[$c]) {
      Write-Host ("  {0,-20} allowed" -f $c) -ForegroundColor Green
    } else {
      Write-Host ("  {0,-20} DENIED (same as the made-up control)" -f $c) -ForegroundColor Yellow
      $ok = $false
    }
  }
  return $ok
}

# ---------------------------------------------------------------------------
if (-not (Test-Path $RulesFile)) { throw "no firestore.rules at $RulesFile" }
$collections = Get-AllowedCollections -Path $RulesFile
if ($collections.Count -eq 0) { throw "could not parse the collection allowlist out of firestore.rules" }

Write-Host ""
Write-Host "firestore.rules lists $($collections.Count) collections:" -ForegroundColor Cyan
Write-Host "  $($collections -join ', ')"

if ($Probe) {
  $ok = Test-LiveCollections -Names $collections
  Write-Host ""
  if ($ok) {
    Write-Host "Live ruleset matches the file." -ForegroundColor Green
    exit 0
  }
  Write-Host "Live ruleset is BEHIND the file - deploy it." -ForegroundColor Yellow
  exit 1
}

if ($DryRun) {
  Write-Host ""
  Write-Host "--- would publish ---" -ForegroundColor Cyan
  Get-Content $RulesFile | Where-Object { $_ -notmatch '^\s*//' -and $_.Trim() -ne '' }
  Write-Host "--- dry run: nothing was published ---" -ForegroundColor Cyan
  exit 0
}

# --- credential -------------------------------------------------------------
if (-not $KeyPath) {
  if ($env:GOOGLE_APPLICATION_CREDENTIALS) {
    $KeyPath = $env:GOOGLE_APPLICATION_CREDENTIALS
  } else {
    $KeyPath = "C:\Users\rober\.secrets\wordvoyage-e5a5c-rules-deploy.json"
  }
}
if (-not (Test-Path $KeyPath)) {
  Write-Host ""
  Write-Host "No service-account key at:" -ForegroundColor Red
  Write-Host "  $KeyPath"
  Write-Host "Pass -KeyPath, or paste the ruleset into the console by hand:"
  Write-Host "  https://console.firebase.google.com/project/$Project/firestore/rules"
  exit 1
}
Write-Host ""
Write-Host "Using key: $KeyPath" -ForegroundColor Cyan

# The principal needs Firebase Rules Admin AND Service Usage Consumer. Without
# the second, deploy 403s on its "is the Firestore API enabled?" precheck
# before it ever touches a rule.
$env:GOOGLE_APPLICATION_CREDENTIALS = $KeyPath
if ($env:Path -notlike "*nodejs*") { $env:Path += ";C:\Program Files\nodejs" }

Push-Location $GamekitDir      # firebase.json lives here; the CLI needs the cwd
try {
  Write-Host "Publishing to $Project ..." -ForegroundColor Cyan
  & npx.cmd --yes firebase-tools deploy --only firestore:rules --project $Project
  $code = $LASTEXITCODE
} finally {
  Pop-Location
}

if ($code -ne 0) {
  Write-Host ""
  Write-Host "Deploy exited $code - nothing was published." -ForegroundColor Red
  exit $code
}

# Never take "deployed" on trust.
$ok = Test-LiveCollections -Names $collections
Write-Host ""
if ($ok) {
  Write-Host "Published and verified." -ForegroundColor Green
  exit 0
}
Write-Host "The CLI reported success but the probe disagrees. Check the output above." -ForegroundColor Red
exit 1
