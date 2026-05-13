# scripts/unlock-rules.ps1
#
# Clears the read-only attribute from rule-enforcement files so the owner
# can make an authorized edit. After the edit, the owner must:
#   1. Run: node scripts\verify-rules-integrity.cjs --write (if RULES.md changed)
#   2. Commit all changes in a single PR that CODEOWNERS must approve.
#   3. Run: powershell -ExecutionPolicy Bypass -File scripts\lock-rules.ps1
#
# Running this script does NOT grant any authority — CODEOWNERS + branch
# protection are still the real gate. It only removes the local
# filesystem-level hint that discourages accidental edits.

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

foreach ($f in $files) {
  if (Test-Path $f) {
    Set-ItemProperty -Path $f -Name IsReadOnly -Value $false
    Write-Host "unlocked  $f"
  }
}

Get-ChildItem -Path 'e2e\acceptance' -File -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
  Set-ItemProperty -Path $_.FullName -Name IsReadOnly -Value $false
  Write-Host ("unlocked  " + $_.FullName.Replace((Get-Location).Path + '\', ''))
}

Write-Host ''
Write-Host 'Enforcement files are now writable. Remember to re-lock after your edit.' -ForegroundColor Yellow
