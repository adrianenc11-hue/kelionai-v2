# Live Monitor — KelionAI Tests
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$outputFile = "C:\Users\adria\.gemini\antigravity\scratch\kelionai-v2\test-results\live-output.txt"

$form = New-Object System.Windows.Forms.Form
$form.Text = "KelionAI Live Monitor"
$form.Size = New-Object System.Drawing.Size(600, 320)
$form.BackColor = [System.Drawing.Color]::FromArgb(15, 23, 42)
$form.StartPosition = "CenterScreen"
$form.TopMost = $true
$form.FormBorderStyle = "FixedDialog"

function MakeLabel($text, $x, $y, $size, $color) {
    $l = New-Object System.Windows.Forms.Label
    $l.Text = $text
    $l.ForeColor = $color
    $l.Font = New-Object System.Drawing.Font("Segoe UI", $size, [System.Drawing.FontStyle]::Bold)
    $l.AutoSize = $true
    $l.Location = New-Object System.Drawing.Point($x, $y)
    $form.Controls.Add($l)
    return $l
}

$titleLbl = MakeLabel "KelionAI Tests" 20 14 14 ([System.Drawing.Color]::FromArgb(148,163,184))
$okLbl    = MakeLabel "✓ 0" 20 55 52 ([System.Drawing.Color]::FromArgb(34,197,94))
$failLbl  = MakeLabel "✗ 0" 170 55 52 ([System.Drawing.Color]::FromArgb(239,68,68))
$skipLbl  = MakeLabel "— 0" 310 55 52 ([System.Drawing.Color]::FromArgb(100,116,139))
$curLbl   = MakeLabel "Astept..." 20 170 10 ([System.Drawing.Color]::FromArgb(148,163,184))
$statusLbl= MakeLabel "IN CURS" 20 200 18 ([System.Drawing.Color]::FromArgb(251,191,36))

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 500
$timer.Add_Tick({
    if (-not (Test-Path $outputFile)) { $curLbl.Text = "Astept fisier output..."; return }
    $lines = @(Get-Content $outputFile -EA SilentlyContinue)
    $ok   = ($lines | Where-Object { $_ -match "^\s*ok\s+\d+" }).Count
    $fail = ($lines | Where-Object { $_ -match "^\s*(not ok|FAILED)\s" }).Count
    $skip = ($lines | Where-Object { $_ -match "^\s*-\s+\[" }).Count
    $okLbl.Text   = "✓ $ok"
    $failLbl.Text = "✗ $fail"
    $skipLbl.Text = "— $skip"
    $last = $lines | Where-Object { $_ -match "tests?\|chrome\|firefox" } | Select-Object -Last 1
    if ($last) { $curLbl.Text = ($last -replace '\x1b\[[0-9;]*m','').Trim() }
    if ($lines | Where-Object { $_ -match "passed|failed|Tests:" }) {
        $statusLbl.Text = if ($fail -eq 0) { "PASS" } else { "FAIL: $fail esecuri" }
        $statusLbl.ForeColor = if ($fail -eq 0) { [System.Drawing.Color]::FromArgb(34,197,94) } else { [System.Drawing.Color]::FromArgb(239,68,68) }
    }
})
$timer.Start()
$form.ShowDialog()
