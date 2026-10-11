# Install / refresh the WorkBuddy foot card plugin into a DSH profile.
#
# What it does (idempotent):
#   1. copy lib\index.js + lib\client.js into <profile>\node_modules\dsh-workbuddy-foot-card\
#   2. add the dependency to <profile>\package.json
#   3. insert the Loader row into <profile>\cordis.patch.yml (unless already present)
#
# ASCII only on purpose: Windows PowerShell 5.1 reads unsigned UTF-8 .ps1 files as
# ANSI, so Chinese text is assembled from code points instead of written literally.
param(
  [string]$Profile = ''
)
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
if ($Profile -eq '') {
  $Profile = Join-Path $env:USERPROFILE '.dsh\profiles\desktop'
}
$pkgName = 'dsh-workbuddy-foot-card'
$target = Join-Path $Profile ("node_modules\$pkgName")
$lib = Join-Path $target 'lib'

Write-Host "source : $root"
Write-Host "profile: $Profile"

foreach ($file in @('package.json', 'lib\index.js', 'lib\client.js')) {
  if (-not (Test-Path -LiteralPath (Join-Path $root $file))) { throw "missing source file: $file" }
}

# 1. copy the package
New-Item -ItemType Directory -Force -Path $lib | Out-Null
Copy-Item -LiteralPath (Join-Path $root 'package.json') -Destination (Join-Path $target 'package.json') -Force
Copy-Item -LiteralPath (Join-Path $root 'lib\index.js') -Destination (Join-Path $lib 'index.js') -Force
Copy-Item -LiteralPath (Join-Path $root 'lib\client.js') -Destination (Join-Path $lib 'client.js') -Force
$clientBytes = (Get-Item -LiteralPath (Join-Path $lib 'client.js')).Length
Write-Host "copied package ($clientBytes byte client bundle)"

# 2. dependency in the profile package.json
$profilePkgPath = Join-Path $Profile 'package.json'
$profilePkg = [System.IO.File]::ReadAllText($profilePkgPath, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
if ($profilePkg.dependencies.PSObject.Properties.Name -notcontains $pkgName) {
  $profilePkg.dependencies | Add-Member -NotePropertyName $pkgName -NotePropertyValue '1.0.0'
  $json = $profilePkg | ConvertTo-Json -Depth 12
  [System.IO.File]::WriteAllText($profilePkgPath, $json + "`n", (New-Object System.Text.UTF8Encoding($false)))
  Write-Host 'added dependency to profile package.json'
} else {
  Write-Host 'dependency already present'
}

# 3. Loader row in cordis.patch.yml
$patchPath = Join-Path $Profile 'cordis.patch.yml'
$patch = if (Test-Path -LiteralPath $patchPath) { [System.IO.File]::ReadAllText($patchPath, [System.Text.Encoding]::UTF8) } else { '' }
if ($patch.Contains($pkgName)) {
  Write-Host 'patch row already present'
} else {
  $row = "`n# WorkBuddy foot card (added by " + $pkgName + " install.ps1)`n- insert:`n    - id: workbuddy-foot-card`n      name: '" + $pkgName + "'`n"
  [System.IO.File]::AppendAllText($patchPath, $row, (New-Object System.Text.UTF8Encoding($false)))
  Write-Host 'appended insert row to cordis.patch.yml'
}

Write-Host ''
Write-Host '=== installed ==='
Get-ChildItem -LiteralPath $target -Recurse -File | ForEach-Object { '  ' + $_.Length.ToString().PadLeft(8) + '  ' + $_.FullName }
Write-Host ''
Write-Host 'Restart DSH Desktop (the host composes the client roster at boot), then the'
Write-Host 'WorkBuddy card shows up above the usage card in the sidebar footer.'
