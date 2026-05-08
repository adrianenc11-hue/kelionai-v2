@echo off
echo ============================================
echo  KelionAI Audio Fix - Run as Administrator
echo ============================================
echo.

REM Solicita drepturi de administrator
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo Requesting administrator privileges...
    powershell -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

echo [1/3] Creating auto-recovery scheduled task...
schtasks /create /tn "KelionAI_AudioRecovery" /tr "powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File C:\Users\adria\.antigravity\extensions\kelionai-v2\scripts\audio_recovery.ps1" /sc onlogon /rl highest /f
echo.

echo [2/3] Running audio recovery NOW...
powershell -ExecutionPolicy Bypass -File "C:\Users\adria\.antigravity\extensions\kelionai-v2\scripts\audio_recovery.ps1"
echo.

echo [3/3] Verifying audio status...
powershell -Command "Get-PnpDevice -Class 'AudioEndpoint' | Select-Object Status, FriendlyName | Format-Table -AutoSize"
echo.

echo ============================================
echo  DONE! Audio should be working now.
echo  The scheduled task will auto-fix after
echo  every lid close/open (standby resume).
echo ============================================
pause
