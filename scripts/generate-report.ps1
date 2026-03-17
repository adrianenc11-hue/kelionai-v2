param(
    [string]$Timestamp = (Get-Date -Format "yyyy-MM-dd_HH-mm-ss"),
    [int]$ExitCode = 0
)

$ProjectDir   = "C:\Users\adria\.gemini\antigravity\scratch\kelionai-v2"
$DesktopDir   = "C:\Users\adria\OneDrive\Desktop"
$JsonResults  = "$ProjectDir\test-results\results.json"
$SpecFile     = "$ProjectDir\tests\e2e-full.spec.js"
$ReportPath   = "$DesktopDir\kelionai-test-report_$Timestamp.html"
$LatestReport = "$DesktopDir\kelionai-test-report-LATEST.html"

if (Test-Path $LatestReport) { Remove-Item $LatestReport -Force }

# ── Incarca fisierul de teste pentru analiza ──────────────────────
$specLines = @()
if (Test-Path $SpecFile) { $specLines = Get-Content $SpecFile }

# ── Analizeaza corpul unui test (extrage ~60 linii de la linia data) ──
function Analyze-TestBody([int]$startLine) {
    if ($specLines.Count -eq 0 -or $startLine -lt 1) { return @{ Fake="?"; HardCoded="?" } }

    $idx   = [Math]::Max(0, $startLine - 1)
    $end   = [Math]::Min($specLines.Count - 1, $idx + 60)
    $body  = ($specLines[$idx..$end]) -join "`n"

    # ── Detectie FAKE ─────────────────────────────────────────────
    $fakeReasons = [System.Collections.Generic.List[string]]::new()

    # Slab: accepta orice raspuns non-5xx
    if ($body -match 'toBeLessThan\(500\)')        { [void]$fakeReasons.Add("orice non-5xx") }
    # Slab: verifica doar tipul valorii, nu valoarea
    if ($body -match 'expect\(typeof ')            { [void]$fakeReasons.Add("verif. tip doar") }
    # Slab: .toBeTruthy() ca unica asertare de date
    if ($body -match '\.toBeTruthy\(\)' -and $body -notmatch '\.toBe\(' -and $body -notmatch '\.toContain\(' -and $body -notmatch '\.toHaveProperty\(') {
        [void]$fakeReasons.Add("assertTrue() slab")
    }
    # Slab: toBeGreaterThanOrEqual fara valoare exacta
    if ($body -match 'toBeGreaterThanOrEqual\(400\)') { [void]$fakeReasons.Add(">=400 prea larg") }
    # Test sare intotdeauna (nu are nicio asertare reala)
    $expectCount = ([regex]::Matches($body, 'expect\(')).Count
    if ($expectCount -eq 0)                        { [void]$fakeReasons.Add("fara expect()") }
    # Accepta liste prea mari de statusuri
    if ($body -match 'toContain\(r\.status\(\)\)' -and ($body -match '\[200.*400.*404\]' -or $body -match '\[.*200.*404.*\]')) {
        [void]$fakeReasons.Add("prea multi status OK")
    }

    $fakeCell = if ($fakeReasons.Count -gt 0) {
        "<span class='flag-yes'>DA</span><br><small>" + ($fakeReasons -join ", ") + "</small>"
    } else { "<span class='flag-no'>Nu</span>" }

    # ── Detectie HARD-CODED ───────────────────────────────────────
    $hcItems = [System.Collections.Generic.List[string]]::new()

    # Cauta in fiecare linie a corpului testului
    $bodyLines = $specLines[$idx..$end]
    $hcPatternStrings = @(
        '\.toBe\("ok"\)'
        '\.toBe\("online"\)'
        '\.toBe\("Forbidden"\)'
        '\.toBe\("Authentication required"\)'
        '\.toBe\("Not authenticated"\)'
        '\.toBe\("Invalid login credentials"\)'
        '\.toBe\("Validation failed"\)'
        '\.toBe\("face image required"\)'
        '\.toBe\("not configured"\)'
        '\.toContain\("API key required"\)'
        '\.toContain\("not configured"\)'
        '\.toBe\("error"\)'
    )
    for ($li = 0; $li -lt $bodyLines.Count; $li++) {
        $lineText = $bodyLines[$li]
        foreach ($pat in $hcPatternStrings) {
            if ($lineText -match $pat) {
                $lineNum  = $idx + $li + 1  # 1-indexed
                $codeSafe = $lineText.Trim() -replace "<","&lt;" -replace ">","&gt;"
                [void]$hcItems.Add("Linia $lineNum`: <code>$codeSafe</code>")
            }
        }
    }

    $hcCell = if ($hcItems.Count -gt 0) {
        $details = $hcItems -join "<br>"
        "<details><summary class='flag-yes'>DA ($($hcItems.Count))</summary><div class='hc-detail'>$details</div></details>"
    } else { "<span class='flag-no'>Nu</span>" }

    return @{ Fake = $fakeCell; HardCoded = $hcCell }
}

# ── Contori si randuri ─────────────────────────────────────────────
$totalTests = 0; $passed = 0; $failed = 0; $skipped = 0; $duration = 0
$rows = [System.Text.StringBuilder]::new()

if (-not (Test-Path $JsonResults)) {
    [void]$rows.Append("<tr><td colspan='6' style='color:#94a3b8;padding:16px'>Nu exista results.json! Ruleaza testele mai intai.</td></tr>")
} else {
    try {
        $json = Get-Content $JsonResults -Raw | ConvertFrom-Json
        $duration = [math]::Round($json.stats.duration / 1000, 1)

        $stack = [System.Collections.Generic.Stack[object]]::new()
        if ($json.suites) {
            foreach ($top in $json.suites) {
                if ($top.suites) {
                    $arr = @($top.suites)
                    for ($i = $arr.Length - 1; $i -ge 0; $i--) {
                        $stack.Push([PSCustomObject]@{ Suite = $arr[$i]; Depth = 0 })
                    }
                }
            }
        }

        while ($stack.Count -gt 0) {
            $entry = $stack.Pop()
            $suite = $entry.Suite
            $depth = $entry.Depth
            $pad   = $depth * 16
            $sTitle = ($suite.title) -replace "<","&lt;" -replace ">","&gt;"

            [void]$rows.Append("<tr class='suite-row'><td colspan='6' style='padding-left:${pad}px'><b>$sTitle</b></td></tr>")

            if ($suite.specs) {
                foreach ($spec in $suite.specs) {
                    $status = "skipped"; $errMsg = ""

                    if ($spec.tests) {
                        foreach ($t in $spec.tests) {
                            if ($t.results) {
                                foreach ($res in $t.results) {
                                    $rs = $res.status
                                    if ($rs -eq "failed" -or $rs -eq "interrupted") {
                                        $status = "failed"
                                        if ($res.PSObject.Properties.Name -contains "error") {
                                            $e = $res.error
                                            if ($e -and $e.PSObject.Properties.Name -contains "message") {
                                                $m = [string]$e.message -replace "`e\[[0-9;]*m",""
                                                $m = $m -replace "<","&lt;" -replace ">","&gt;"
                                                if ($m.Length -gt 400) { $m = $m.Substring(0,400) + "..." }
                                                $errMsg = $m
                                            }
                                        }
                                    } elseif ($rs -eq "passed" -and $status -ne "failed") { $status = "passed" }
                                }
                            }
                            if ($t.PSObject.Properties.Name -contains "status") {
                                $ts = $t.status
                                if ($ts -eq "unexpected" -and $status -ne "failed") { $status = "failed" }
                                if ($ts -eq "expected"   -and $status -eq "skipped") { $status = "passed" }
                            }
                        }
                    }

                    $totalTests++
                    if     ($status -eq "passed")  { $passed++ }
                    elseif ($status -eq "failed")  { $failed++ }
                    else                           { $skipped++ }

                    # Analiza test pentru fake/hardcoded
                    $specLine = if ($spec.PSObject.Properties.Name -contains "line") { [int]$spec.line } else { 0 }
                    $analysis = Analyze-TestBody $specLine

                    $icon = if ($status -eq "passed") { "&#10003;" } elseif ($status -eq "failed") { "&#10007;" } else { "&#8212;" }
                    $cls  = if ($status -eq "passed") { "row-pass" } elseif ($status -eq "failed") { "row-fail" } else { "row-skip" }
                    $sp   = ($depth + 1) * 16
                    $tt   = ($spec.title) -replace "<","&lt;" -replace ">","&gt;"
                    $ed   = if ($errMsg) { "<div class='err-msg'>$errMsg</div>" } else { "" }

                    [void]$rows.Append("<tr class='$cls'>" +
                        "<td class='num'>$totalTests</td>" +
                        "<td style='padding-left:${sp}px'>$tt$ed</td>" +
                        "<td class='icon'>$icon</td>" +
                        "<td>$sTitle</td>" +
                        "<td class='flag'>$($analysis.Fake)</td>" +
                        "<td class='flag'>$($analysis.HardCoded)</td>" +
                        "</tr>")
                }
            }

            if ($suite.suites) {
                $arr = @($suite.suites)
                for ($i = $arr.Length - 1; $i -ge 0; $i--) {
                    $stack.Push([PSCustomObject]@{ Suite = $arr[$i]; Depth = ($depth + 1) })
                }
            }
        }
    } catch {
        [void]$rows.Append("<tr><td colspan='6' style='color:#f87171;padding:12px'>Eroare: $_</td></tr>")
    }
}

$overallStatus = if ($failed -eq 0 -and $totalTests -gt 0) { "PASS" } else { "FAIL" }
$overallColor  = if ($overallStatus -eq "PASS") { "#22c55e" } else { "#ef4444" }
$dateDisplay   = $Timestamp -replace "_"," " -replace "-","/"

$css = "*{box-sizing:border-box;margin:0;padding:0}" +
"body{font-family:'Segoe UI',sans-serif;background:#0f172a;color:#e2e8f0;min-height:100vh}" +
"header{background:#1e293b;border-bottom:1px solid #334155;padding:20px 28px;display:flex;align-items:center;gap:14px}" +
"h1{font-size:20px;font-weight:700;color:#f1f5f9}" +
"small{color:#94a3b8;font-size:12px;display:block;margin-top:4px}" +
".badge{display:inline-block;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:700;color:#fff;margin-left:8px;vertical-align:middle;background:$overallColor}" +
".container{max-width:1300px;margin:0 auto;padding:24px}" +
".stats{display:flex;gap:12px;margin-bottom:24px;flex-wrap:wrap}" +
".stat{background:#1e293b;border:1px solid #334155;border-radius:10px;padding:14px 22px;text-align:center;min-width:100px}" +
".stat .n{font-size:28px;font-weight:800}.stat .l{font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;margin-top:4px}" +
"table{width:100%;border-collapse:collapse;font-size:12px}" +
"th{background:#0f172a;color:#64748b;text-align:left;padding:8px 10px;font-size:11px;text-transform:uppercase;letter-spacing:.04em;border-bottom:1px solid #334155;white-space:nowrap}" +
"td{padding:7px 10px;border-bottom:1px solid #1e293b;vertical-align:top}" +
".num{text-align:center;width:36px;color:#64748b;font-size:11px}" +
".suite-row td{background:#0f172a;color:#64748b;font-size:11px;font-weight:700;padding:6px 10px;letter-spacing:.05em;text-transform:uppercase}" +
".row-pass{border-left:3px solid #22c55e}" +
".row-fail{border-left:3px solid #ef4444;background:rgba(239,68,68,.05)}" +
".row-skip{border-left:3px solid #334155;opacity:.55}" +
".icon{text-align:center;font-size:15px;width:36px}" +
".row-pass .icon{color:#22c55e}.row-fail .icon{color:#ef4444}.row-skip .icon{color:#475569}" +
".flag{font-size:11px;width:110px;vertical-align:top}" +
".flag small{display:block;color:#94a3b8;margin-top:2px;line-height:1.3}" +
".flag-yes{color:#ef4444;font-weight:700}" +
".flag-no{color:#22c55e}" +
".err-msg{font-size:10px;color:#fca5a5;background:rgba(239,68,68,.1);border-radius:4px;padding:4px 7px;margin-top:4px;white-space:pre-wrap;word-break:break-word}" +
"details summary{cursor:pointer;user-select:none}" +
"details summary:hover{opacity:.8}" +
".hc-detail{margin-top:6px;padding:6px 8px;background:#1e293b;border-radius:4px;font-size:11px;color:#94a3b8;line-height:1.6}" +
".hc-detail code{color:#fbbf24;font-family:monospace;font-size:10px}" +
"footer{text-align:center;color:#475569;font-size:11px;padding:20px}"

$html = "<!DOCTYPE html><html lang='ro'><head><meta charset='UTF-8'/><title>KelionAI Tests $dateDisplay</title><style>$css</style></head><body>" +
    "<header><span style='font-size:26px'>&#x1F916;</span><div><h1>KelionAI E2E Tests <span class='badge'>$overallStatus</span></h1><small>$dateDisplay | Durata: ${duration}s | Total: $totalTests | Trecute: $passed | Esecuri: $failed | Omise: $skipped</small></div></header>" +
    "<div class='container'>" +
    "<table><thead><tr>" +
    "<th>#</th><th>Test</th><th>Status</th><th>Sectiune</th>" +
    "<th title='Test cu asertari prea slabe sau fara verificari reale'>Fake?</th>" +
    "<th title='Valori hardcodate detectate in asertari'>Hard-coded?</th>" +
    "</tr></thead><tbody>" +
    $rows.ToString() +
    "</tbody></table></div>" +
    "<footer>KelionAI Test Report &mdash; $dateDisplay | Analiza automata: fake = asertari slabe; hard-coded = valori literale specifice detectate in test</footer></body></html>"

$html | Out-File -FilePath $LatestReport -Encoding UTF8 -Force

Write-Host "Raport actualizat: kelionai-test-report-LATEST.html"
Write-Host "Total: $totalTests | Trecute: $passed | Esecuri: $failed | Omise: $skipped | Durata: ${duration}s"
