@echo off
chcp 65001 >nul 2>nul
title KelionAI v2.1 — Deploy Automat
color 0B

echo.
echo ══════════════════════════════════════════════════
echo   KelionAI v2.1 — DEPLOY AUTOMAT TOTAL
echo   Acest script face TOT. Stai și privește.
echo ══════════════════════════════════════════════════
echo.

:: Check if git exists
where git >nul 2>nul
if %errorlevel% neq 0 (
    echo ❌ Git nu e instalat! Descarcă de la: https://git-scm.com/download/win
    echo    Instalează-l și rulează din nou acest script.
    pause
    exit /b 1
)

:: Check if node exists
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo ❌ Node.js nu e instalat! Descarcă de la: https://nodejs.org
    echo    Instalează-l și rulează din nou acest script.
    pause
    exit /b 1
)

echo ✅ Git și Node.js sunt instalate
echo.

:: Navigate to project
cd /d "%~dp0"
echo 📁 Director: %CD%
echo.

:: Create .env if missing
if not exist ".env" (
    if exist ".env.example" (
        echo 📝 Copiez .env.example ca .env...
        copy ".env.example" ".env" >nul
        echo ✅ .env creat din .env.example
        echo.
        echo ⚠️  IMPORTANT: Deschide fișierul .env și completează cheile tale API!
        echo    Editează cu: notepad .env
        echo.
        notepad .env
    ) else (
        echo ❌ Lipsește fișierul .env.example! Asigură-te că ai clonat repo-ul complet.
        pause
        exit /b 1
    )
) else (
    echo ✅ .env deja există
)

:: Install dependencies
echo.
echo 📦 Instalez dependențe...
call npm install --silent 2>nul
if %errorlevel% neq 0 (
    echo ⚠️  npm install a avut probleme, încerc din nou...
    call npm install
)
echo ✅ Dependențe instalate
echo.

:: Run setup (Supabase tables + API tests)
echo 🗄️  Rulez setup-ul automat (tabele Supabase + teste)...
node setup.js
echo.

:: Git operations
echo 🔄 Pregătesc push la GitHub...

:: Configure git if needed
git config user.email >nul 2>nul
if %errorlevel% neq 0 (
    git config user.email "adrian@kelionai.dev"
    git config user.name "Adrian"
)

:: Add all files
git add -A

:: Create commit
git commit -m "v2.1: Audio fix + Auth + Memory + Full Automation" --allow-empty >nul 2>nul
echo ✅ Commit creat

:: Push
echo.
echo 🚀 Push la GitHub...
echo    (Dacă cere username/password, introdu-le)
echo.
git push origin master 2>&1
if %errorlevel% neq 0 (
    echo.
    echo ⚠️  Push-ul a eșuat. Probabil trebuie un token GitHub.
    echo.
    echo    INSTRUCȚIUNI:
    echo    1. Mergi la: https://github.com/settings/tokens
    echo    2. Click "Generate new token (classic)"
    echo    3. Bifează: repo (tot)
    echo    4. Copiază token-ul generat
    echo    5. Rulează manual:
    echo       git remote set-url origin https://TOKEN@github.com/adrianenc11-hue/kelionai-v2.git
    echo       git push origin master
    echo.
    echo    Înlocuiește TOKEN cu token-ul tău.
    echo.
) else (
    echo.
    echo ✅ Push-ul a reușit! Railway face auto-deploy.
    echo.
)

:: Test local
echo ══════════════════════════════════════════════════
echo   TOTUL E GATA!
echo.
echo   🌐 Railway: https://kelionai-v2-production.up.railway.app/
echo   💻 Local:   http://localhost:3000
echo.
echo   ⚠️  ULTIMUL PAS (o singură dată):
echo   Dacă tabelele Supabase nu s-au creat automat:
echo   1. Deschide: https://supabase.com/dashboard/project/nqlobybfwmtkmsqadqqr/sql
echo   2. Copiază conținutul din server/schema.sql
echo   3. Apasă "Run"
echo ══════════════════════════════════════════════════
echo.

:: Offer to start local server
set /p START="Vrei să pornești serverul local? (d/n): "
if /i "%START%"=="d" (
    echo.
    echo 🚀 Pornesc serverul...
    node server/index.js
)

pause
