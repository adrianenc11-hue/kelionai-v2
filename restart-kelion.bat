@echo off
chcp 65001 >nul
:: KelionAI Auto-Restart Launcher
:: Pune acest fișier pe Desktop sau în C:\Users\adria\kelionai-v2\
:: Dublu-click pentru a porni aplicația (server + frontend dev)

title KelionAI Auto-Restart

echo ═══════════════════════════════════════════
echo   KelionAI — Pornire automată
echo ═══════════════════════════════════════════
echo.

:: Navighează la folderul proiectului
set "PROJECT_DIR=%~dp0"
if not exist "%PROJECT_DIR%package.json" (
  :: Dacă BAT-ul e pe Desktop, încearcă calea fixă
  set "PROJECT_DIR=C:\Users\adria\kelionai-v2\"
)

cd /d "%PROJECT_DIR%"
if errorlevel 1 (
  echo [EROARE] Nu găsesc folderul proiectului: %PROJECT_DIR%
  echo          Mută acest fișier în C:\Users\adria\kelionai-v2\
  pause
  exit /b 1
)

echo [1/4] Folder proiect: %CD%

:: Oprește procese vechi Node pe porturile 3000/3001
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3001') do (
  echo [2/4] Oprește server vechi pe port 3001 (PID %%a)...
  taskkill /F /PID %%a >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :5173') do (
  echo [2/4] Oprește Vite dev vechi pe port 5173 (PID %%a)...
  taskkill /F /PID %%a >nul 2>&1
)

:: Așteaptă un pic
timeout /t 2 /nobreak >nul

echo [3/4] Instalează dependențele (dacă lipsesc)...
call npm install --silent
if errorlevel 1 (
  echo [AVERTISMENT] npm install a eșuat, încercăm să continuăm oricum...
)

echo [4/4] Build frontend...
call npm run build
if errorlevel 1 (
  echo [EROARE] Build-ul a eșuat.
  pause
  exit /b 1
)

echo.
echo ═══════════════════════════════════════════
echo   KelionAI pornește acum...
echo   Server: http://localhost:3001
echo   Admin:  http://localhost:3001/admin
echo ═══════════════════════════════════════════
echo.
echo Apasă CTRL+C și apoi Y pentru a opri.
echo.

:: Pornește serverul și deschide browser-ul
start "KelionAI Server" /min cmd /c "cd /d %CD%\server && npx nodemon src/index.js --watch src --ext js,mjs,json || node src/index.js"
timeout /t 5 /nobreak >nul
start http://localhost:3001

:: Keep window open so user sees logs
pause
