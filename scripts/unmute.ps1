# Unmute system audio and set volume to 75%
$wshell = New-Object -ComObject WScript.Shell
# Volume Mute toggle key
$wshell.SendKeys([char]173)
Start-Sleep -Milliseconds 200
# Set volume up several times to ensure audible level
for ($i = 0; $i -lt 15; $i++) {
    $wshell.SendKeys([char]175)
    Start-Sleep -Milliseconds 50
}
Write-Host "Speaker unmuted and volume raised"
