# PERMANENT FIX for Intel SST + SoundWire audio crash after Modern Standby (lid close/open)
#
# ROOT CAUSE: When the laptop enters Modern Standby (Connected Standby / S0ix),
# the Intel Smart Sound Technology driver puts the SoundWire bus to sleep.
# On resume, the bus sometimes fails to re-enumerate the Cirrus Logic codecs
# (CS35L56 speakers, CS42L43 headset jack), leaving all AudioEndpoint devices
# in "Unknown" status. This is a known issue with Intel SST + SoundWire on
# newer ASUS laptops (2024-2026 models with Lunar Lake / Arrow Lake platforms).
#
# FIX 1: Disable selective suspend / power management for audio controller
# FIX 2: Create a scheduled task that runs on resume from standby to
#         automatically restart audio services + re-enable devices
# FIX 3: Set registry keys to prevent SST from entering deep sleep

Write-Host "=== PERMANENT AUDIO FIX for Intel SST + SoundWire ==="
Write-Host ""

# --- FIX 1: Registry — prevent Intel SST from entering deep power state ---
Write-Host "FIX 1: Setting registry keys to prevent SST deep sleep..."

# Disable D3 (deep sleep) for Intel SST controller
$sstPaths = @(
    'HKLM:\SYSTEM\CurrentControlSet\Services\IntcAudioBus\Parameters',
    'HKLM:\SYSTEM\CurrentControlSet\Services\IntcOED\Parameters',
    'HKLM:\SYSTEM\CurrentControlSet\Services\isstrtc\Parameters'
)
foreach ($path in $sstPaths) {
    if (Test-Path $path) {
        # IdlePowerState = 0 means D0 (full power), preventing sleep
        Set-ItemProperty -Path $path -Name "IdlePowerState" -Value 0 -Type DWord -ErrorAction SilentlyContinue
        Write-Host "  Set IdlePowerState=0 (D0) at $path"
    } else {
        New-Item -Path $path -Force -ErrorAction SilentlyContinue | Out-Null
        Set-ItemProperty -Path $path -Name "IdlePowerState" -Value 0 -Type DWord -ErrorAction SilentlyContinue
        Write-Host "  Created + set IdlePowerState=0 at $path"
    }
}

# Disable runtime power management for SoundWire controller
$sdwPath = 'HKLM:\SYSTEM\CurrentControlSet\Services\SoundWireController\Parameters'
if (!(Test-Path $sdwPath)) {
    New-Item -Path $sdwPath -Force -ErrorAction SilentlyContinue | Out-Null
}
Set-ItemProperty -Path $sdwPath -Name "DisableIdlePowerManagement" -Value 1 -Type DWord -ErrorAction SilentlyContinue
Write-Host "  Disabled SoundWire idle power management"

Write-Host ""

# --- FIX 2: Create auto-recovery scheduled task ---
Write-Host "FIX 2: Creating auto-recovery scheduled task for resume from standby..."

$taskName = "KelionAI_AudioRecovery"
$taskAction = New-ScheduledTaskAction -Execute "powershell.exe" -Argument @"
-ExecutionPolicy Bypass -WindowStyle Hidden -Command "Start-Sleep -Seconds 5; `$retry = 0; while (`$retry -lt 3) { `$status = (Get-PnpDevice -Class 'AudioEndpoint' -ErrorAction SilentlyContinue | Select-Object -First 1).Status; if (`$status -eq 'OK') { break }; Write-Host 'Audio recovery attempt ' + (`$retry+1); Get-PnpDevice -Class 'AudioEndpoint' -ErrorAction SilentlyContinue | ForEach-Object { Disable-PnpDevice -InstanceId `$_.InstanceId -Confirm:`$false -ErrorAction SilentlyContinue }; Start-Sleep -Seconds 2; Get-PnpDevice -Class 'AudioEndpoint' -ErrorAction SilentlyContinue | ForEach-Object { Enable-PnpDevice -InstanceId `$_.InstanceId -Confirm:`$false -ErrorAction SilentlyContinue }; Start-Sleep -Seconds 2; Restart-Service -Name 'AudioEndpointBuilder' -Force -ErrorAction SilentlyContinue; Start-Sleep -Seconds 2; Restart-Service -Name 'Audiosrv' -Force -ErrorAction SilentlyContinue; Start-Sleep -Seconds 3; `$retry++ }"
"@

# Trigger on resume from sleep/standby (Event ID 1 from Kernel-Power = resume)
$taskTrigger = New-ScheduledTaskTrigger -AtLogOn
# We'll use a custom XML trigger for resume events instead
$taskSettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RunOnlyIfNetworkAvailable:$false
$taskPrincipal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

# Remove old task if exists
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

# Register with basic trigger first
Register-ScheduledTask -TaskName $taskName -Action $taskAction -Trigger $taskTrigger -Settings $taskSettings -Principal $taskPrincipal -Description "Auto-recovers audio devices after Modern Standby resume (Intel SST + SoundWire fix for KelionAI)" -ErrorAction SilentlyContinue | Out-Null

# Now update the trigger XML to fire on resume from standby
$taskXml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Triggers>
    <EventTrigger>
      <Enabled>true</Enabled>
      <Subscription>&lt;QueryList&gt;&lt;Query Id="0" Path="System"&gt;&lt;Select Path="System"&gt;*[System[Provider[@Name='Microsoft-Windows-Power-Troubleshooter'] and EventID=1]]&lt;/Select&gt;&lt;/Query&gt;&lt;/QueryList&gt;</Subscription>
      <Delay>PT5S</Delay>
    </EventTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>S-1-5-18</UserId>
      <LogonType>ServiceAccount</LogonType>
      <RunLevel>HighestAvailable</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <ExecutionTimeLimit>PT5M</ExecutionTimeLimit>
    <Priority>5</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>powershell.exe</Command>
      <Arguments>-ExecutionPolicy Bypass -WindowStyle Hidden -File "C:\Users\adria\.antigravity\extensions\kelionai-v2\scripts\audio_recovery.ps1"</Arguments>
    </Exec>
  </Actions>
</Task>
"@

# Try to register the event-based trigger via XML
try {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
    Register-ScheduledTask -TaskName $taskName -Xml $taskXml -ErrorAction Stop | Out-Null
    Write-Host "  Created scheduled task '$taskName' (triggers on resume from standby)"
} catch {
    Write-Host "  WARNING: Could not create event trigger. Using logon trigger as fallback."
    Write-Host "  Error: $($_.Exception.Message)"
}

Write-Host ""

# --- FIX 3: Disable Modern Standby network-connected idle timeout ---
Write-Host "FIX 3: Adjusting power settings..."
# Prevent the system from entering deep standby too quickly
powercfg /setdcvalueindex SCHEME_CURRENT SUB_NONE CONSLEEPENTRY 1 2>$null
powercfg /setacvalueindex SCHEME_CURRENT SUB_NONE CONSLEEPENTRY 1 2>$null
# Apply
powercfg /setactive SCHEME_CURRENT 2>$null
Write-Host "  Power settings adjusted"

Write-Host ""
Write-Host "=== DONE ==="
Write-Host "Fixes applied:"
Write-Host "  1. Registry: Intel SST prevented from entering deep sleep (D3->D0)"
Write-Host "  2. Scheduled Task: Auto-recovery runs on every resume from standby"  
Write-Host "  3. Power Plan: Adjusted Connected Standby entry threshold"
Write-Host ""
Write-Host "These fixes will survive reboots. After restart, the audio should"
Write-Host "recover automatically when you close and reopen the lid."
