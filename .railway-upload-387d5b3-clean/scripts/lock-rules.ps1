# scripts/lock-rules.ps1
#
# Sets the rule-enforcement files to read-only at the Windows filesystem
# level. Run this ONCE, as the owner, after committing RULES.md and the
# related files. Any subsequent agent attempt to modify these files via
# normal tooling will fail with an access-denied error.
#
# Run:
#   powershell -ExecutionPolicy Bypass -File scripts\lock-rules.ps1
#
# To unlock temporarily (owner only), run scripts\unlock-rules.ps1.
#
# This is a defense in depth. The primary protection is CODEOWNERS +
# branch protection on GitHub. OS-level read-only prevents accidental
# local edits.

$ErrorActionPreference = 'Stop'

$files = @(
  'RULES.md',
  'RULES.sha256',
  '.augment\rules.md',
  'CODEOWNERS',
  'DELIVERY_CONTRACT.md',
  'scripts\verify-rules-integrity.cjs',
  'scripts\verify-agent-report.cjs',
  'scripts\lock-rules.ps1',
  'scripts\lock-rules.sh',
  '.github\workflows\rules-integrity.yml',
  '.github\workflows\acceptance.yml'
)

$missing = @()
foreach ($f in $files) {
  if (-not (Test-Path $f)) { $missing += $f }
}
if ($missing.Count -gt 0) {
  Write-Host 'Cannot lock: missing files:' -ForegroundColor Yellow
  $missing | ForEach-Object { Write-Host "  $_" }
  exit 2
}

foreach ($f in $files) {
  try {
    Set-ItemProperty -Path $f -Name IsReadOnly -Value $true
    Write-Host "locked  $f"
  } catch {
    Write-Host "FAILED to lock $f : $_" -ForegroundColor Red
    exit 1
  }
}

# Also lock the e2e/acceptance directory contents (but leave directory itself
# writable so new acceptance scripts can still be added via PR).
Get-ChildItem -Path 'e2e\acceptance' -File -Recurse | ForEach-Object {
  Set-ItemProperty -Path $_.FullName -Name IsReadOnly -Value $true
  Write-Host ("locked  " + $_.FullName.Replace((Get-Location).Path + '\', ''))
}

Write-Host ''
Write-Host 'All enforcement files are now read-only on disk.' -ForegroundColor Green
Write-Host 'Any tool that attempts to modify them will receive an access-denied error.'
Write-Host 'To unlock for an authorized edit, run: scripts\unlock-rules.ps1'
