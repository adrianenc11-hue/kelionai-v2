param(
    [string]$Timestamp = (Get-Date -Format "yyyy-MM-dd_HH-mm-ss"),
    [int]$ExitCode = 0
)

$ProjectDir   = "C:\Users\adria\.gemini\antigravity\scratch\kelionai-v2"
$DesktopDir   = "C:\Users\adria\OneDrive\Desktop"
$JsonResults  = "$ProjectDir\test-results\results.json"
$LiveOutput   = "$ProjectDir\test-results\live-output.txt"
$SpecFile     = "$ProjectDir\tests\e2e-full.spec.js"
$ReportPath   = "$DesktopDir\kelionai-test-report_$Timestamp.html"
$LatestReport = "$DesktopDir\kelionai-test-report-LATEST.html"
$HistoryFile  = "$ProjectDir\test-results\test-history.json"

if (Test-Path $LatestReport) { Remove-Item $LatestReport -Force }

# ── Incarca fisierul de teste pentru analiza ──────────────────────
$specLines = @()
if (Test-Path $SpecFile) { $specLines = Get-Content $SpecFile }

# ── Analizeaza corpul unui test ───────────────────────────────────
function Analyze-TestBody([int]$startLine) {
    if ($specLines.Count -eq 0 -or $startLine -lt 1) { return @{ Fake="?"; HardCoded="?" } }

    $idx   = [Math]::Max(0, $startLine - 1)
    $end   = [Math]::Min($specLines.Count - 1, $idx + 60)
    $body  = ($specLines[$idx..$end]) -join "`n"

    $fakeReasons = [System.Collections.Generic.List[string]]::new()
    if ($body -match 'toBeLessThan\(500\)')        { [void]$fakeReasons.Add("orice non-5xx") }
    if ($body -match 'expect\(typeof ')            { [void]$fakeReasons.Add("verif. tip doar") }
    if ($body -match '\.toBeTruthy\(\)' -and $body -notmatch '\.toBe\(' -and $body -notmatch '\.toContain\(' -and $body -notmatch '\.toHaveProperty\(') {
        [void]$fakeReasons.Add("assertTrue() slab")
    }
    if ($body -match 'toBeGreaterThanOrEqual\(400\)') { [void]$fakeReasons.Add(">=400 prea larg") }
    $expectCount = ([regex]::Matches($body, 'expect\(')).Count
    if ($expectCount -eq 0) { [void]$fakeReasons.Add("fara expect()") }

    $fakeCell = if ($fakeReasons.Count -gt 0) {
        "<span class='flag-yes'>DA</span><br><small>" + ($fakeReasons -join ", ") + "</small>"
    } else { "<span class='flag-no'>Nu</span>" }

    $hcItems = [System.Collections.Generic.List[string]]::new()
    $bodyLines = $specLines[$idx..$end]
    $hcPatterns = @('\.toBe\("ok"\)','\.toBe\("online"\)','\.toBe\("Forbidden"\)','\.toBe\("Authentication required"\)','\.toBe\("Not authenticated"\)','\.toBe\("Invalid login credentials"\)','\.toBe\("Validation failed"\)','\.toBe\("face image required"\)','\.toBe\("not configured"\)','\.toContain\("API key required"\)','\.toContain\("not configured"\)','\.toBe\("error"\)')
    for ($li = 0; $li -lt $bodyLines.Count; $li++) {
        $lineText = $bodyLines[$li]
        foreach ($pat in $hcPatterns) {
            if ($lineText -match $pat) {
                $lineNum  = $idx + $li + 1
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

# ── Date din results.json (primar) ───────────────────────────────
$totalTests = 0; $passed = 0; $failed = 0; $skipped = 0; $duration = 0
$rows = [System.Text.StringBuilder]::new()
$dataSource = "none"

if (Test-Path $JsonResults) {
    $dataSource = "json"
    try {
        $json = Get-Content $JsonResults -Raw | ConvertFrom-Json
        $duration = [math]::Round($json.stats.duration / 1000, 1)

        $stack = [System.Collections.Generic.Stack[object]]::new()
        if ($json.suites) {
            foreach ($top in $json.suites) {
                # Itereaza specs de la nivel top (suites cu specs directe)
                if ($top.specs) {
                    foreach ($spec in $top.specs) {
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
                                                    if ($m.Length -gt 300) { $m = $m.Substring(0,300) + "..." }
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

                        $specLine = if ($spec.PSObject.Properties.Name -contains "line") { [int]$spec.line } else { 0 }
                        $analysis = Analyze-TestBody $specLine
                        $icon = if ($status -eq "passed") { "&#10003;" } elseif ($status -eq "failed") { "&#10007;" } else { "&#8212;" }
                        $cls  = if ($status -eq "passed") { "row-pass" } elseif ($status -eq "failed") { "row-fail" } else { "row-skip" }
                        $tt   = ($spec.title) -replace "<","&lt;" -replace ">","&gt;"
                        $ed   = if ($errMsg) { "<div class='err-msg'>$errMsg</div>" } else { "" }
                        $sName = ($top.title) -replace "<","&lt;" -replace ">","&gt;"
                        [void]$rows.Append("<tr class='$cls'><td class='num'>$totalTests</td><td>$tt$ed</td><td class='icon'>$icon</td><td>$sName</td><td class='flag'>$($analysis.Fake)</td><td class='flag'>$($analysis.HardCoded)</td></tr>")
                    }
                }
                # Itereaza sub-suite-uri
                if ($top.suites) {
                    $arr = @($top.suites)
                    for ($i = $arr.Length - 1; $i -ge 0; $i--) {
                        $stack.Push([PSCustomObject]@{ Suite = $arr[$i]; Parent = $top.title })
                    }
                }
            }
        }

        while ($stack.Count -gt 0) {
            $entry  = $stack.Pop()
            $suite  = $entry.Suite
            $parent = $entry.Parent
            $sTitle = ($suite.title) -replace "<","&lt;" -replace ">","&gt;"

            if ($suite.specs -and $suite.specs.Count -gt 0) {
                [void]$rows.Append("<tr class='suite-row'><td colspan='6'><b>$sTitle</b></td></tr>")
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
                                                if ($m.Length -gt 300) { $m = $m.Substring(0,300) + "..." }
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

                    $specLine = if ($spec.PSObject.Properties.Name -contains "line") { [int]$spec.line } else { 0 }
                    $analysis = Analyze-TestBody $specLine
                    $icon = if ($status -eq "passed") { "&#10003;" } elseif ($status -eq "failed") { "&#10007;" } else { "&#8212;" }
                    $cls  = if ($status -eq "passed") { "row-pass" } elseif ($status -eq "failed") { "row-fail" } else { "row-skip" }
                    $tt   = ($spec.title) -replace "<","&lt;" -replace ">","&gt;"
                    $ed   = if ($errMsg) { "<div class='err-msg'>$errMsg</div>" } else { "" }
                    [void]$rows.Append("<tr class='$cls'><td class='num'>$totalTests</td><td>$tt$ed</td><td class='icon'>$icon</td><td>$sTitle</td><td class='flag'>$($analysis.Fake)</td><td class='flag'>$($analysis.HardCoded)</td></tr>")
                }
            }

            if ($suite.suites) {
                $arr = @($suite.suites)
                for ($i = $arr.Length - 1; $i -ge 0; $i--) {
                    $stack.Push([PSCustomObject]@{ Suite = $arr[$i]; Parent = $sTitle })
                }
            }
        }
    } catch {
        [void]$rows.Append("<tr><td colspan='6' style='color:#f87171;padding:12px'>Eroare JSON: $_</td></tr>")
    }
}

# ── FALLBACK: parsare live-output.txt (când results.json lipseste) ─
if ($totalTests -eq 0 -and (Test-Path $LiveOutput)) {
    $dataSource = "live-output"
    # Citim cu encoding Default (Windows-1252) pentru a evita coruperea caracterelor ANSI
    try {
        $rawBytes = [System.IO.File]::ReadAllBytes($LiveOutput)
        $raw = [System.Text.Encoding]::Default.GetString($rawBytes)
    } catch {
        $raw = [System.IO.File]::ReadAllText($LiveOutput, [System.Text.Encoding]::UTF8)
    }
    $lines = $raw -split "`n"

    # Extr. stats din JSON partial sau linia summary Playwright
    if ($raw -match '"expected"\s*:\s*(\d+)')   { $passed  = [int]$Matches[1] }
    if ($raw -match '"unexpected"\s*:\s*(\d+)') { $failed  = [int]$Matches[1] }
    if ($raw -match '"skipped"\s*:\s*(\d+)')    { $skipped = [int]$Matches[1] }
    if ($raw -match '"duration"\s*:\s*([\d.]+)') { $duration = [math]::Round([double]$Matches[1] / 1000, 1) }
    if ($passed -eq 0) {
        $m = [regex]::Match($raw, '(\d+)\s+passed'); if ($m.Success) { $passed  = [int]$m.Groups[1].Value }
        $m = [regex]::Match($raw, '(\d+)\s+failed'); if ($m.Success) { $failed  = [int]$m.Groups[1].Value }
        $m = [regex]::Match($raw, '(\d+)\s+skipped'); if ($m.Success) { $skipped = [int]$m.Groups[1].Value }
    }
    $totalTests = $passed + $failed + $skipped

    # Extr. rânduri individuale Playwright list: contin [chromium]
    $testLines = $lines | Where-Object { $_ -match "\[chromium\]" }
    $rowIdx = 0
    foreach ($tl in $testLines) {
        $rowIdx++
        # Detectam status din ANSI color:
        #   verde \x1b[32m = passed    rosu \x1b[31m = failed   galben/rest = skipped
        $isPass = $tl -match "\x1b\[32m"
        $isFail = $tl -match "\x1b\[31m"
        $status = if ($isPass) { "passed" } elseif ($isFail) { "failed" } else { "skipped" }

        # Eliminam ANSI escape codes
        $clean = $tl -replace "\x1b\[[0-9;]*m",""

        # Extrage textul testului: totul dupa ultimul " › "
        $arrowIdx = $clean.LastIndexOf([char]0x203A)  # ›
        if ($arrowIdx -gt 0) {
            $testName = $clean.Substring($arrowIdx + 1).Trim()
        } else {
            # Fallback: dupa [chromium]
            $brIdx = $clean.IndexOf("]")
            $testName = if ($brIdx -gt 0) { $clean.Substring($brIdx + 1).Trim() } else { $clean.Trim() }
        }
        $testName = $testName -replace "\s*\(\d+(?:\.\d+)?[ms]+\)\s*$",""
        $testName = $testName.Trim() -replace "<","&lt;" -replace ">","&gt;"

        $icon = if ($status -eq "passed") { "&#10003;" } elseif ($status -eq "failed") { "&#10007;" } else { "&#8212;" }
        $cls  = if ($status -eq "passed") { "row-pass" } elseif ($status -eq "failed") { "row-fail" } else { "row-skip" }
        [void]$rows.Append("<tr class='$cls'><td class='num'>$rowIdx</td><td>$testName</td><td class='icon'>$icon</td><td style='color:#64748b;font-size:11px'>live-output</td><td class='flag'><span style='color:#64748b'>-</span></td><td class='flag'><span style='color:#64748b'>-</span></td></tr>")
    }

    if ($totalTests -eq 0) {
        [void]$rows.Append("<tr><td colspan='6' style='color:#fbbf24;padding:16px'>&#9888; Testele au fost intrerupte inainte de terminare. Ruleaza din nou pentru raport complet.</td></tr>")
    }
}

# ── Dacă nu există nicio sursă de date ───────────────────────────
if ($totalTests -eq 0 -and $dataSource -eq "none") {
    [void]$rows.Append("<tr><td colspan='6' style='color:#94a3b8;padding:16px'>Nu exista date de test. Ruleaza testele cu <code>run-e2e-tests.bat</code>.</td></tr>")
}

$overallStatus = if ($failed -eq 0 -and $totalTests -gt 0) { "PASS" } else { "FAIL" }
$overallColor  = if ($overallStatus -eq "PASS") { "#22c55e" } else { "#ef4444" }
$dateDisplay   = $Timestamp -replace "_"," " -replace "-","/"
$srcBadge      = if ($dataSource -eq "live-output") { " <span style='font-size:10px;background:#92400e;color:#fde68a;padding:2px 6px;border-radius:4px'>date parțiale</span>" } else { "" }

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

$js = "window.onload=function(){filterProblems()};var showAll=false;" +
"function toggleView(){showAll=!showAll;" +
"document.querySelectorAll('.row-pass,.suite-row').forEach(function(r){r.style.display=showAll?'':'none'});" +
"document.getElementById('toggleBtn').textContent=showAll?'Arata doar probleme':'Arata toate ('+document.querySelectorAll('.row-pass').length+' trecute)';};" +
"function filterProblems(){document.querySelectorAll('.row-pass,.suite-row').forEach(function(r){r.style.display='none';});" +
"document.getElementById('toggleBtn').textContent='Arata toate ('+document.querySelectorAll('.row-pass').length+' trecute)';};"

$statsHtml = "<div class='stats'>" +
    "<div class='stat'><div class='n'>$totalTests</div><div class='l'>Total</div></div>" +
    "<div class='stat' style='border-color:#22c55e'><div class='n' style='color:#22c55e'>$passed</div><div class='l'>Trecute</div></div>" +
    "<div class='stat' style='border-color:#ef4444'><div class='n' style='color:#ef4444'>$failed</div><div class='l'>Esecuri</div></div>" +
    "<div class='stat'><div class='n' style='color:#64748b'>$skipped</div><div class='l'>Omise</div></div>" +
    "<div class='stat'><div class='n' style='color:#94a3b8'>${duration}s</div><div class='l'>Durata</div></div>" +
    "</div>"

$html = "<!DOCTYPE html><html lang='ro'><head><meta charset='UTF-8'/><title>KelionAI Tests $dateDisplay</title><style>$css</style></head><body>" +
    "<header><span style='font-size:26px'>&#x1F916;</span><div><h1>KelionAI E2E Tests <span class='badge'>$overallStatus</span>$srcBadge</h1><small>$dateDisplay &nbsp;|&nbsp; Total: $totalTests &nbsp;|&nbsp; Trecute: $passed &nbsp;|&nbsp; Esecuri: $failed &nbsp;|&nbsp; Omise: $skipped &nbsp;|&nbsp; Durata: ${duration}s</small></div>" +
    "<button id='toggleBtn' onclick='toggleView()' style='margin-left:auto;padding:8px 16px;background:#334155;color:#f1f5f9;border:none;border-radius:6px;cursor:pointer;font-size:12px'>Arata toate</button></header>" +
    "<div class='container'>" +
    $statsHtml +
    "<table><thead><tr>" +
    "<th>#</th><th>Test</th><th>Status</th><th>Sectiune</th>" +
    "<th title='Test cu asertari prea slabe sau fara verificari reale'>Fake?</th>" +
    "<th title='Valori hardcodate detectate in asertari'>Hard-coded?</th>" +
    "</tr></thead><tbody>" +
    $rows.ToString() +
    "</tbody></table></div>" +
    "<footer>KelionAI Test Report &mdash; $dateDisplay | Sursa date: $dataSource</footer>" +
    "<script>$js</script></body></html>"

# ── Istoricul rulărilor ───────────────────────────────────────────
$history = @()
if (Test-Path $HistoryFile) {
    try { $history = @(Get-Content $HistoryFile -Raw | ConvertFrom-Json) } catch {}
}
$history += [PSCustomObject]@{
    date    = $dateDisplay
    total   = $totalTests
    passed  = $passed
    failed  = $failed
    skipped = $skipped
    status  = $overallStatus
    source  = $dataSource
}
$history | ConvertTo-Json -Depth 3 | Out-File -FilePath $HistoryFile -Encoding UTF8 -Force

# ── Tabelul de evolutie ───────────────────────────────────────────
$evoRows = ""
for ($hi = [Math]::Max(0, $history.Count - 10); $hi -lt $history.Count; $hi++) {
    $h = $history[$hi]
    $sc = if ($h.status -eq 'PASS') { '#22c55e' } else { '#ef4444' }
    $diff = if ($hi -gt 0) {
        $prev = $history[$hi - 1]
        $d = 0
        try { $d = [int]([string]$h.passed) - [int]([string]$prev.passed) } catch {}
        if ($d -gt 0) { "<span style='color:#22c55e'>+$d</span>" }
        elseif ($d -lt 0) { "<span style='color:#ef4444'>$d</span>" }
        else { "=" }
    } else { "-" }
    $srcCol = if ($h.source -eq "live-output") { "<span style='color:#fbbf24'>partial</span>" } else { $h.source }
    $evoRows += "<tr><td>$($h.date)</td><td>$($h.total)</td><td style='color:#22c55e'>$($h.passed)</td><td style='color:#ef4444'>$($h.failed)</td><td style='color:#94a3b8'>$($h.skipped)</td><td>$diff</td><td style='color:$sc;font-weight:700'>$($h.status)</td><td style='color:#64748b;font-size:10px'>$srcCol</td></tr>"
}
$evoTable = "<div class='container' style='margin-top:0;padding-top:0'><h3 style='color:#64748b;font-size:12px;letter-spacing:.05em;text-transform:uppercase;margin-bottom:8px'>Evolutie (ultimele rulari)</h3><table style='font-size:11px'><thead><tr><th>Data</th><th>Total</th><th>Trecute</th><th>Esecuri</th><th>Omise</th><th>Diff</th><th>Status</th><th>Sursa</th></tr></thead><tbody>$evoRows</tbody></table></div>"

# ── Salveaza raportul ─────────────────────────────────────────────
$html | Out-File -FilePath $LatestReport -Encoding UTF8 -Force
$content = Get-Content $LatestReport -Raw
$content = $content -replace '<footer>', "$evoTable<footer>"
$content | Out-File -FilePath $LatestReport -Encoding UTF8 -Force

Write-Host "Raport actualizat: kelionai-test-report-LATEST.html"
Write-Host "Sursa date: $dataSource"
Write-Host "Total: $totalTests | Trecute: $passed | Esecuri: $failed | Omise: $skipped | Durata: ${duration}s"
