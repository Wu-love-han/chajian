# install.ps1 - one-command installer for the Money & Credits Card plugin.
#
# Whoever receives this folder (a human, or the next AI) only needs to run:
#   powershell -ExecutionPolicy Bypass -File tools\install.ps1
#
# It does everything and then tells you the required next step:
#   1. locate the dsh CLI and the target profile
#   2. run `dsh plugin add <this folder>`  (writes dependency + bundles; the
#      package ships its own cordis.patch.yml, so the Loader row is automatic)
#   3. verify the install actually landed
#   4. print what to do next (a FULL restart of DSH Desktop is required)
#
# Design rules (do not change, they are load-bearing):
#   - ASCII only: Windows PowerShell 5.1 reads an unsigned UTF-8 script as ANSI,
#     so non-ASCII text breaks string parsing.
#   - No external modules: only git / node / dsh that the host already has.
#   - Fail loudly with the exact fix, never silently.
#
# Parameters:
#   -ProfileName <name>   target profile name (default 'desktop'; web edition: 'web')
#   -ProfileDir <path>    target profile folder (overrides -ProfileName)
#   -DshPath <path>       explicit dsh.cmd (otherwise auto-discovered)
#   -SkipInstall          only verify an existing install

param(
  [string]$ProfileName = 'desktop',
  [string]$ProfileDir = '',
  [string]$DshPath = '',
  [string]$KeepCopy = '',
  [switch]$SkipInstall
)
$ErrorActionPreference = 'Stop'

function Say($t)  { Write-Host $t }
function Ok($t)   { Write-Host ('  [OK]   ' + $t) }
function Warn($t) { Write-Host ('  [WARN] ' + $t) }
function Fail($t) { Write-Host ('  [FAIL] ' + $t); exit 1 }

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
if (Test-Path (Join-Path $here 'package.json')) { $pkgRoot = $here }
elseif (Test-Path (Join-Path (Split-Path -Parent $here) 'package.json')) { $pkgRoot = Split-Path -Parent $here }
else { Fail 'package.json not found near install.ps1 - run it from inside the plugin folder' }

Say '=== Money & Credits Card - installer ==='
Say ('source  : ' + $pkgRoot)

# A local install becomes a directory junction pointing at the source folder, so
# deleting or moving the source silently breaks the plugin. When the source is a
# throwaway location (Downloads, a temp extraction folder), stash a copy under a
# stable path first and install from there.
if ($KeepCopy -eq '') { $KeepCopy = Join-Path $env:USERPROFILE '.dsh\plugins\dsh-workbuddy-foot-card' }
$volatile = $false
foreach ($marker in @($env:TEMP, 'Downloads', 'Downloads\', '\Desktop\')) {
  if ($marker -and $pkgRoot.StartsWith($marker, [System.StringComparison]::OrdinalIgnoreCase)) { $volatile = $true }
}
if ($volatile -and -not $SkipInstall) {
  Say ('source looks temporary; copying to a stable path: ' + $KeepCopy)
  if (Test-Path $KeepCopy) { Remove-Item $KeepCopy -Recurse -Force }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $KeepCopy) | Out-Null
  Copy-Item $pkgRoot $KeepCopy -Recurse -Force
  $pkgRoot = $KeepCopy
  Ok ('source is now: ' + $pkgRoot)
}

# 1. locate the dsh CLI
if ($DshPath -eq '') {
  $candidates = @()
  $hostCmdRoot = Join-Path $env:APPDATA 'DSH Desktop\host-commands'
  if (Test-Path $hostCmdRoot) {
    $candidates += (Get-ChildItem $hostCmdRoot -Recurse -Filter 'dsh.cmd' -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime -Descending | Select-Object -ExpandProperty FullName)
  }
  $onPath = Get-Command dsh -ErrorAction SilentlyContinue
  if ($onPath) { $candidates += $onPath.Source }
  $DshPath = $candidates | Where-Object { $_ } | Select-Object -First 1
}
if (-not $DshPath) {
  Fail "dsh CLI not found. Open DSH Desktop once (it generates the CLI) or pass -DshPath <path to dsh.cmd>."
}
Ok ('dsh     : ' + $DshPath)

# 2. locate the profile
# NOTE: `dsh plugin --profile` takes a NAME (desktop / web / headless), never a
# full path - passing a path fails with `invalid profile name`. So we resolve the
# folder for verification, but always hand the NAME to the CLI.
$profileName = $ProfileName
if ($ProfileDir -ne '') {
  $trimmed = $ProfileDir.TrimEnd('\', '/')
  $profileName = Split-Path -Leaf $trimmed
  Say ('profile : ' + $trimmed + '  (derived name: ' + $profileName + ')')
} else {
  $ProfileDir = Join-Path $env:USERPROFILE ('.dsh\profiles\' + $profileName)
  Say ('profile : ' + $ProfileDir)
}
if (-not (Test-Path $ProfileDir)) {
  Fail ('profile not found: ' + $ProfileDir + '  (try -ProfileName web)')
}
if (-not (Test-Path (Join-Path $ProfileDir 'package.json'))) {
  Fail ('profile looks empty (no package.json): ' + $ProfileDir)
}
Ok ('profile name: ' + $profileName)

# 2b. heal a stale manual Loader row (crash prevention)
#
# This package ships its own cordis.patch.yml (declared as dsh.bundle.patch), and
# `dsh plugin add` already inserts that Loader row through the bundle. An OLDER
# version of this script ALSO appended the same row to the profile's own
# cordis.patch.yml. With both present the composed profile carries the id twice:
#
#     dsh-plugin-desktop: duplicate loader entry id "workbuddy-foot-card"
#
# and DSH refuses to compose, dropping into recovery mode. Remove any such manual
# block here, so re-running this installer always converges to exactly ONE insert.
$profilePatch = Join-Path $ProfileDir 'cordis.patch.yml'
if (Test-Path $profilePatch) {
  try {
    $patchLines = [System.IO.File]::ReadAllLines($profilePatch, [System.Text.Encoding]::UTF8)
    $idIndex = -1
    for ($i = 0; $i -lt $patchLines.Count; $i++) {
      if ($patchLines[$i] -match '^[ \t]*-[ \t]*id:[ \t]*workbuddy-foot-card[ \t]*$') { $idIndex = $i; break }
    }
    if ($idIndex -ge 0) {
      $start = $idIndex
      for ($i = $idIndex - 1; $i -ge 0 -and $i -ge $idIndex - 20; $i--) {
        if ($patchLines[$i] -match '^[ \t]*-[ \t]*insert:[ \t]*$') { $start = $i; break }
      }
      while ($start - 1 -ge 0 -and $patchLines[$start - 1] -match '^[ \t]*#.*workbuddy') { $start-- }
      $insertIndent = ([regex]::Match($patchLines[$start], '^([ \t]*)')).Groups[1].Value.Length
      $end = $idIndex
      for ($i = $idIndex + 1; $i -lt $patchLines.Count; $i++) {
        $line = $patchLines[$i]
        if ($line.Trim() -eq '') { $end = $i; continue }
        $indent = ([regex]::Match($line, '^([ \t]*)')).Groups[1].Value.Length
        if ($indent -le $insertIndent) { break }
        $end = $i
      }
      $backup = $profilePatch + '.stale-insert-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
      Copy-Item $profilePatch $backup -Force
      $kept = @()
      for ($i = 0; $i -lt $patchLines.Count; $i++) {
        if ($i -lt $start -or $i -gt $end) { $kept += $patchLines[$i] }
      }
      [System.IO.File]::WriteAllText($profilePatch, (($kept -join "`r`n") + "`r`n"), (New-Object System.Text.UTF8Encoding($false)))
      Warn ('removed a STALE manual Loader row from the profile patch (backup: ' + (Split-Path -Leaf $backup) + ')')
      Ok 'that stale row is exactly what made DSH report "duplicate loader entry id"; the bundle inserts it for you'
    } else {
      Ok 'profile patch carries no manual Loader row (good)'
    }
  } catch {
    Warn ('could not inspect the profile patch: ' + $_.Exception.Message)
  }
}

# 3. install
# If a previous install recorded a bare version (e.g. "1.0.0") from a time when the
# package did not exist on npm, pnpm would try the registry and fail with a 404.
# Removing first makes the re-install reproducible from this folder alone.
if (-not $SkipInstall) {
  $installedPkg = Join-Path $ProfileDir 'node_modules\dsh-workbuddy-foot-card'
  $existingDep = ''
  try {
    $probe = [System.IO.File]::ReadAllText((Join-Path $ProfileDir 'package.json'), [System.Text.Encoding]::UTF8) | ConvertFrom-Json
    if ($probe.dependencies -and $probe.dependencies.PSObject.Properties.Name -contains 'dsh-workbuddy-foot-card') {
      $existingDep = [string]$probe.dependencies.'dsh-workbuddy-foot-card'
    }
  } catch { $existingDep = '' }
  if ($existingDep -ne '' -and $existingDep -notmatch '^(file:|link:|github:|git\+|https?://)') {
    Warn ('existing dependency looks like a registry version (' + $existingDep + '); removing it first')
    & $DshPath plugin --profile $profileName remove dsh-workbuddy-foot-card 2>&1 | Out-Null
  }

  Say ''
  Say ('installing (runs: dsh plugin --profile ' + $profileName + ' add .) ...')
  Push-Location $pkgRoot
  try {
    & $DshPath plugin --profile $profileName add '.'
    $code = $LASTEXITCODE
  } finally {
    Pop-Location
  }
  if ($code -ne 0) {
    Fail @'
install failed. Common causes:
  - ERR_PNPM_IGNORED_BUILDS: the profile needs an allowBuilds whitelist. Run the
    command pnpm printed, or copy the profile's existing pnpm-workspace.yaml.
  - "Could not resolve plugin to a commit": you passed a /tree/<branch> web URL.
    Use this local folder instead, or github:owner/repo#branch.
  - "invalid profile name": --profile takes a NAME (desktop/web), not a full path.
'@
  }
  Ok 'dsh plugin add finished'

  # 3b. prove the id is inserted exactly ONCE - the invariant whose violation
  #     drops DSH into recovery mode with "duplicate loader entry id".
  $manualInserts = 0
  try {
    $txt = [System.IO.File]::ReadAllText($profilePatch, [System.Text.Encoding]::UTF8)
    $manualInserts = ([regex]::Matches($txt, '^[ \t]*-[ \t]*id:[ \t]*workbuddy-foot-card[ \t]*$', 'Multiline')).Count
  } catch { $manualInserts = 0 }
  if ($manualInserts -ne 0) {
    Fail @'
the profile patch STILL carries a manual Loader row for this plugin.
That duplicates the row the bundle inserts, and DSH will refuse to boot with
"duplicate loader entry id". Delete that "- insert:" block from:
  <profile>\cordis.patch.yml
(then re-run this installer).
'@
  }
  Ok 'exactly one Loader insert (supplied by the bundle, none by hand)'
}

# 4. verify
Say ''
Say 'verifying ...'
$profilePkg = [System.IO.File]::ReadAllText((Join-Path $ProfileDir 'package.json'), [System.Text.Encoding]::UTF8) | ConvertFrom-Json
$depNames = @()
if ($profilePkg.dependencies) { $depNames = $profilePkg.dependencies.PSObject.Properties.Name }
if ($depNames -notcontains 'dsh-workbuddy-foot-card') {
  Fail 'dsh-workbuddy-foot-card is NOT in the profile package.json after install'
}
Ok 'profile package.json has the dependency'

$bundles = @()
if ($profilePkg.dsh -and $profilePkg.dsh.profile -and $profilePkg.dsh.profile.bundles) { $bundles = $profilePkg.dsh.profile.bundles }
if ($bundles -notcontains 'dsh-workbuddy-foot-card') {
  Warn 'not listed in dsh.profile.bundles - add it there or the card will not mount'
} else {
  Ok 'listed in dsh.profile.bundles (DSH mounts it automatically)'
}

$installed = Join-Path $ProfileDir 'node_modules\dsh-workbuddy-foot-card'
if (-not (Test-Path $installed)) { Fail ('installed copy missing: ' + $installed) }
# A junction to a now-missing folder still "exists" in PowerShell, so test the
# payload instead of the folder itself.
foreach ($f in @('package.json', 'cordis.patch.yml', 'lib\client.js')) {
  if (Test-Path (Join-Path $installed $f)) { Ok ('present: ' + $f) } else { Fail ('missing in installed copy: ' + $f) }
}
$item = Get-Item $installed -Force
if ($item.LinkType) {
  $target = @($item.Target)[0]
  if (Test-Path $target) {
    Ok ('linked to: ' + $target)
    Warn 'this is a LINK - do not delete or move that folder, or the plugin breaks'
  } else {
    Fail ('the link target no longer exists: ' + $target + '  (re-run this installer from the plugin folder)')
  }
}

# 5. next steps
Say ''
Say '=== done. NEXT STEP (required) ==='
Say ''
Say '  Fully QUIT DSH Desktop and start it again.'
Say '  The client plugin roster is composed when the host boots, so a page'
Say '  refresh is NOT enough. (After this first restart, code-only changes'
Say '  only need a page refresh.)'
Say ''
Say '  Then look at the sidebar FOOTER, just above the Settings row. You should'
Say '  see two rows and a total:'
Say '     DeepSeek     today in CNY + account balance   (money)'
Say '     WorkBuddy    today in credits + remaining     (credits)'
Say '     Today total  CNY amount + N credits'
Say ''
Say '  If a row says "not installed / read failed", that is expected when the'
Say '  upstream plugin is absent - this card only READS their routes:'
Say '     DeepSeek row   <- @linxin666/dsh-usage'
Say '     WorkBuddy row  <- dsh-workbuddy-connect'
Say ''
Say '  Self-check (optional, no browser needed):'
Say ('     node "' + (Join-Path $pkgRoot 'tools\smoke.mjs') + '"')
Say ''
