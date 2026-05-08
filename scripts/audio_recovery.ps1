# Audio Recovery Script — runs automatically after resume from Modern Standby
# Triggered by scheduled task KelionAI_AudioRecovery (Event ID 1 from Power-Troubleshooter)
#
# Checks if audio devices are in "Unknown" state after resume and
# automatically re-enables them + restarts audio services.

$logFile = "$env:TEMP\kelionai_audio_recovery.log"
$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

function Log($msg) {
    "$timestamp $msg" | Out-File -Append -FilePath $logFile
}

Log "=== Audio recovery triggered (resume from standby) ==="

# Wait a moment for hardware to settle
Start-Sleep -Seconds 3

# Check if audio endpoints are OK
$endpoints = Get-PnpDevice -Class 'AudioEndpoint' -ErrorAction SilentlyContinue
$broken = $endpoints | Where-Object { $_.Status -ne 'OK' }

if ($broken.Count -eq 0) {
    Log "All audio endpoints are OK. No recovery needed."
    exit 0
}

Log "Found $($broken.Count) broken audio endpoints. Starting recovery..."

# Attempt recovery up to 3 times
for ($attempt = 1; $attempt -le 3; $attempt++) {
    Log "Recovery attempt $attempt of 3..."
    
    # Step 1: Disable all broken audio endpoints
    foreach ($d in $broken) {
        Log "  Disabling: $($d.FriendlyName)"
        Disable-PnpDevice -InstanceId $d.InstanceId -Confirm:$false -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 2
    
    # Step 2: Disable and re-enable the main MEDIA devices (Intel SST, Cirrus Logic)
    $mediaDevices = Get-PnpDevice -Class 'MEDIA' -ErrorAction SilentlyContinue | Where-Object {
        $_.FriendlyName -match 'Cirrus Logic XU \(with APO|Intel.*Smart Sound.*Digital|SoundWire Audio'
    }
    foreach ($d in $mediaDevices) {
        Log "  Resetting MEDIA device: $($d.FriendlyName)"
        Disable-PnpDevice -InstanceId $d.InstanceId -Confirm:$false -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 500
        Enable-PnpDevice -InstanceId $d.InstanceId -Confirm:$false -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 2
    
    # Step 3: Re-enable all audio endpoints
    foreach ($d in $broken) {
        Log "  Enabling: $($d.FriendlyName)"
        Enable-PnpDevice -InstanceId $d.InstanceId -Confirm:$false -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 2
    
    # Step 4: Restart audio services
    Log "  Restarting AudioEndpointBuilder..."
    Restart-Service -Name 'AudioEndpointBuilder' -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    Log "  Restarting Audiosrv..."
    Restart-Service -Name 'Audiosrv' -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 3
    
    # Check result
    $stillBroken = Get-PnpDevice -Class 'AudioEndpoint' -ErrorAction SilentlyContinue | Where-Object { $_.Status -ne 'OK' }
    
    if ($stillBroken.Count -eq 0) {
        Log "SUCCESS: All audio endpoints recovered after attempt $attempt!"
        
        # Unmute and set volume
        try {
            Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class VolCtrl {
    [DllImport("user32.dll")]
    public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, int dwExtraInfo);
    public static void VolumeUp() {
        keybd_event(0xAF, 0, 0, 0);
        keybd_event(0xAF, 0, 2, 0);
    }
}
'@
            for ($i = 0; $i -lt 5; $i++) { [VolCtrl]::VolumeUp(); Start-Sleep -Milliseconds 100 }
            Log "  Volume raised"
        } catch {
            Log "  Could not raise volume: $($_.Exception.Message)"
        }
        
        exit 0
    }
    
    Log "  Still $($stillBroken.Count) broken endpoints. Retrying..."
    Start-Sleep -Seconds 2
}

Log "FAILED: Could not recover audio after 3 attempts. Manual restart may be needed."
exit 1
