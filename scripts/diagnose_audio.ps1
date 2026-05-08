# Deep investigation of audio crash root cause
# Check Event Viewer, driver versions, power management

Write-Host "=== 1. RECENT AUDIO ERRORS IN EVENT LOG ==="
$audioErrors = Get-WinEvent -FilterHashtable @{
    LogName = 'System'
    Level = 1,2,3  # Critical, Error, Warning
    StartTime = (Get-Date).AddHours(-6)
} -ErrorAction SilentlyContinue | Where-Object {
    $_.Message -match 'audio|sound|cirrus|soundwire|Intel.*SST|speaker|microphone|endpoint'
}
if ($audioErrors) {
    foreach ($e in $audioErrors | Select-Object -First 20) {
        Write-Host "`n[$($e.TimeCreated)] [$($e.LevelDisplayName)] Source: $($e.ProviderName)"
        Write-Host "  ID: $($e.Id) - $($e.Message.Substring(0, [Math]::Min(300, $e.Message.Length)))"
    }
} else {
    Write-Host "No audio-related errors found in last 6 hours"
}

Write-Host "`n`n=== 2. DEVICE MANAGER ERROR CODES ==="
Get-PnpDevice -Class 'AudioEndpoint' -ErrorAction SilentlyContinue | ForEach-Object {
    $props = Get-PnpDeviceProperty -InstanceId $_.InstanceId -ErrorAction SilentlyContinue
    $errCode = ($props | Where-Object { $_.KeyName -eq 'DEVPKEY_Device_ConfigManagerErrorCode' }).Data
    $problem = ($props | Where-Object { $_.KeyName -eq 'DEVPKEY_Device_ProblemCode' }).Data
    Write-Host "  $($_.FriendlyName): Status=$($_.Status), ErrorCode=$errCode, ProblemCode=$problem"
}

Write-Host "`n`n=== 3. INTEL SST DRIVER VERSION ==="
Get-PnpDevice -Class 'MEDIA' -ErrorAction SilentlyContinue | Where-Object {
    $_.FriendlyName -match 'Intel|Cirrus|SoundWire'
} | Select-Object -First 5 | ForEach-Object {
    $driver = Get-PnpDeviceProperty -InstanceId $_.InstanceId -KeyName 'DEVPKEY_Device_DriverVersion' -ErrorAction SilentlyContinue
    $driverDate = Get-PnpDeviceProperty -InstanceId $_.InstanceId -KeyName 'DEVPKEY_Device_DriverDate' -ErrorAction SilentlyContinue
    Write-Host "  $($_.FriendlyName): Driver=$($driver.Data), Date=$($driverDate.Data)"
}

Write-Host "`n`n=== 4. POWER MANAGEMENT SETTINGS FOR AUDIO DEVICES ==="
# Check if USB selective suspend or device power management is causing issues
Get-PnpDevice -Class 'MEDIA' -ErrorAction SilentlyContinue | Where-Object {
    $_.FriendlyName -match 'Intel.*Sound|Cirrus|SoundWire Audio'
} | Select-Object -First 3 | ForEach-Object {
    $powerProp = Get-PnpDeviceProperty -InstanceId $_.InstanceId -KeyName 'DEVPKEY_Device_PowerData' -ErrorAction SilentlyContinue
    $pmEnabled = Get-PnpDeviceProperty -InstanceId $_.InstanceId -KeyName 'DEVPKEY_DeviceClass_PowerManagementSupported' -ErrorAction SilentlyContinue
    Write-Host "  $($_.FriendlyName): PM=$($pmEnabled.Data)"
}

Write-Host "`n`n=== 5. RECENT SLEEP/HIBERNATE EVENTS ==="
$sleepEvents = Get-WinEvent -FilterHashtable @{
    LogName = 'System'
    ProviderName = 'Microsoft-Windows-Kernel-Power','Microsoft-Windows-Power-Troubleshooter'
    StartTime = (Get-Date).AddHours(-6)
} -ErrorAction SilentlyContinue | Select-Object -First 10
foreach ($e in $sleepEvents) {
    Write-Host "  [$($e.TimeCreated)] ID:$($e.Id) - $($e.Message.Substring(0, [Math]::Min(200, $e.Message.Length)))"
}

Write-Host "`n`n=== 6. CHECK POWER PLAN SETTINGS ==="
powercfg /query SCHEME_CURRENT SUB_MULTIMEDIA 2>&1 | Select-Object -First 30 | ForEach-Object { Write-Host $_ }
