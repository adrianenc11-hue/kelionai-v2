# Create the KelionAI Audio Recovery scheduled task
# Triggers on logon + can be run manually after standby resume

$taskName = 'KelionAI_AudioRecovery'

# Remove old task
try { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -EA SilentlyContinue } catch {}

$action = New-ScheduledTaskAction `
    -Execute 'powershell.exe' `
    -Argument '-ExecutionPolicy Bypass -WindowStyle Hidden -File "C:\Users\adria\.antigravity\extensions\kelionai-v2\scripts\audio_recovery.ps1"'

$trigger = New-ScheduledTaskTrigger -AtLogOn

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable

Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -RunLevel Highest `
    -Description 'Auto-recovers audio devices after Modern Standby resume (Intel SST + SoundWire fix)' | Out-Null

Write-Host "Scheduled task '$taskName' created successfully!"
Write-Host "It will run at logon and can also be triggered manually."
