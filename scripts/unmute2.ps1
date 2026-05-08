$code = @'
using System;
using System.Runtime.InteropServices;

public class VolumeControl {
    [DllImport("user32.dll")]
    public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, int dwExtraInfo);
    
    public const byte VK_VOLUME_MUTE = 0xAD;
    public const byte VK_VOLUME_UP = 0xAF;
    public const uint KEYEVENTF_KEYUP = 0x0002;
    
    public static void ToggleMute() {
        keybd_event(VK_VOLUME_MUTE, 0, 0, 0);
        keybd_event(VK_VOLUME_MUTE, 0, KEYEVENTF_KEYUP, 0);
    }
    
    public static void VolumeUp() {
        keybd_event(VK_VOLUME_UP, 0, 0, 0);
        keybd_event(VK_VOLUME_UP, 0, KEYEVENTF_KEYUP, 0);
    }
}
'@
Add-Type -TypeDefinition $code
[VolumeControl]::ToggleMute()
Start-Sleep -Milliseconds 300
for ($i = 0; $i -lt 10; $i++) {
    [VolumeControl]::VolumeUp()
    Start-Sleep -Milliseconds 100
}
Write-Host "Mute toggled + volume raised"
