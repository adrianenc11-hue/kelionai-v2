# Disable and re-enable the main Intel audio controller to force driver reload
# This is the nuclear option that usually fixes "Unknown" audio devices
Write-Host "=== Resetting Intel Smart Sound Technology audio controller ==="

# Find the main Intel SST audio controller (High Definition Audio)
$controllers = Get-PnpDevice | Where-Object { 
    ($_.Class -eq 'MEDIA' -or $_.Class -eq 'System' -or $_.Class -eq 'AudioEndpoint') -and 
    $_.FriendlyName -match 'Intel|Cirrus|SoundWire|Audio'
}

Write-Host "`nFound $($controllers.Count) audio-related devices"

# First try: disable and re-enable Cirrus Logic (the main codec)
$cirrus = Get-PnpDevice | Where-Object { $_.FriendlyName -match 'Cirrus Logic XU \(with APO' }
if ($cirrus) {
    Write-Host "`nDisabling main codec: $($cirrus.FriendlyName)..."
    Disable-PnpDevice -InstanceId $cirrus.InstanceId -Confirm:$false -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    Write-Host "Re-enabling main codec..."
    Enable-PnpDevice -InstanceId $cirrus.InstanceId -Confirm:$false -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 3
}

# Also try the Intel SST Digital Microphones
$dmic = Get-PnpDevice | Where-Object { $_.FriendlyName -match 'Digital Microphones' }
if ($dmic) {
    Write-Host "`nDisabling: $($dmic.FriendlyName)..."
    Disable-PnpDevice -InstanceId $dmic.InstanceId -Confirm:$false -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
    Write-Host "Re-enabling..."
    Enable-PnpDevice -InstanceId $dmic.InstanceId -Confirm:$false -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
}

# Restart audio services after device reset
Write-Host "`nRestarting audio services..."
Restart-Service -Name 'AudioEndpointBuilder' -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Restart-Service -Name 'Audiosrv' -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3

# Check result
Write-Host "`n=== Final status ==="
Get-PnpDevice -Class 'AudioEndpoint' -ErrorAction SilentlyContinue | 
    Select-Object Status, FriendlyName | Format-Table -AutoSize
