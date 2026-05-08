# Re-enable all audio endpoint devices and scan for hardware changes
Write-Host "Enabling all audio endpoints..."
$devices = Get-PnpDevice -Class 'AudioEndpoint' -ErrorAction SilentlyContinue
foreach ($d in $devices) {
    if ($d.Status -ne 'OK') {
        Write-Host "Enabling: $($d.FriendlyName) [Status: $($d.Status)]"
        Enable-PnpDevice -InstanceId $d.InstanceId -Confirm:$false -ErrorAction SilentlyContinue
    }
}

Write-Host "`n--- Enabling MEDIA devices ---"
$mediaDevices = Get-PnpDevice -Class 'MEDIA' -ErrorAction SilentlyContinue
foreach ($d in $mediaDevices) {
    if ($d.Status -ne 'OK') {
        Write-Host "Enabling: $($d.FriendlyName) [Status: $($d.Status)]"
        Enable-PnpDevice -InstanceId $d.InstanceId -Confirm:$false -ErrorAction SilentlyContinue
    }
}

Write-Host "`n--- Scanning for hardware changes ---"
pnputil /scan-devices
Start-Sleep -Seconds 3

Write-Host "`n--- Restarting audio services ---"
Restart-Service -Name 'AudioEndpointBuilder' -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Restart-Service -Name 'Audiosrv' -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

Write-Host "`n--- Current audio endpoint status ---"
Get-PnpDevice -Class 'AudioEndpoint' -ErrorAction SilentlyContinue | Select-Object Status, FriendlyName | Format-Table -AutoSize
