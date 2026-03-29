$output = "$env:USERPROFILE\.gemini\antigravity\scratch\kelionai-v2\test-results\live-output.txt"
$host.UI.RawUI.WindowTitle = "KelionAI MONITOR"
$host.UI.RawUI.BackgroundColor = "Black"
Clear-Host

while ($true) {
    $ok = 0; $fail = 0; $skip = 0; $last = "Astept teste..."

    if (Test-Path $output) {
        # Read raw bytes to handle encoding correctly
        $raw = [System.IO.File]::ReadAllText($output, [System.Text.Encoding]::UTF8)
        $lines = $raw -split "`n"

        # Count browser lines: format is "  X  NNN [chromium]"
        # Skip: starts with spaces + "-" + spaces + digits + "[chromium"
        $skip = ($lines | Where-Object { $_ -match "^\s+-\s+\d+\s+\[" }).Count
        # All browser test lines
        $all  = ($lines | Where-Object { $_ -match "\[chromium\]|\[firefox\]|\[webkit\]" -and $_ -match "^\s+.\s+\d+" }).Count
        # Summary line (most accurate)
        $sumLine = $lines | Where-Object { $_ -match "\d+\s+passed" } | Select-Object -Last 1
        if ($sumLine) {
            if ($sumLine -match "(\d+)\s+passed")  { $ok   = [int]$Matches[1] }
            if ($sumLine -match "(\d+)\s+failed")  { $fail = [int]$Matches[1] }
            if ($sumLine -match "(\d+)\s+skipped") { $skip = [int]$Matches[1] }
        } else {
            # During run: estimate from all lines
            $ok   = $all - $skip
            $fail = 0
        }
        $lastLine = $lines | Where-Object { $_ -match "\[chromium\]|\[firefox\]" } | Select-Object -Last 1
        if ($lastLine) { $last = $lastLine.Trim() -replace "\x1b\[[0-9;]*m",'' }
        if ($last.Length -gt 75) { $last = $last.Substring(0, 75) + "..." }
    }

    [Console]::SetCursorPosition(0, 0)
    Write-Host ""
    Write-Host "  =======================================" -ForegroundColor DarkCyan
    Write-Host "     KelionAI TEST MONITOR (live)       " -ForegroundColor Cyan
    Write-Host "  =======================================" -ForegroundColor DarkCyan
    Write-Host ""
    Write-Host ("  TRECUTE:  " + ($ok.ToString()).PadLeft(4))   -ForegroundColor Green
    Write-Host ""
    Write-Host ("  ESECURI:  " + ($fail.ToString()).PadLeft(4)) -ForegroundColor Red
    Write-Host ""
    Write-Host ("  OMISE:    " + ($skip.ToString()).PadLeft(4)) -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "  ---------------------------------------" -ForegroundColor DarkGray
    Write-Host ("  " + $last)                              -ForegroundColor DarkYellow
    Write-Host ""
    Start-Sleep -Milliseconds 800
}
