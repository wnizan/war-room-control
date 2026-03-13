@echo off
title War Room Control — Launcher
color 0A

echo.
echo  ============================================
echo   WAR ROOM CONTROL — Battlefield Dashboard
echo  ============================================
echo.

:: ── Check Node.js ─────────────────────────────
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERROR] Node.js not found. Install from https://nodejs.org
    pause
    exit /b 1
)

for /f "tokens=*" %%v in ('node -v') do set NODE_VER=%%v
echo  Node: %NODE_VER%

:: ── Install dependencies if needed ────────────
echo.
echo  [1/2] Checking server dependencies...
if not exist "server\node_modules" (
    echo       Installing server packages...
    cd server && call npm install && cd ..
) else (
    echo       Server packages OK
)

echo  [2/2] Checking client dependencies...
if not exist "client\node_modules" (
    echo       Installing client packages...
    cd client && call npm install && cd ..
) else (
    echo       Client packages OK
)

:: ── Start server ───────────────────────────────
echo.
echo  Starting server on http://localhost:3001 ...
start "WR-Server" cmd /k "cd /d %~dp0server && npm run dev"

:: Give server 2 seconds to boot
timeout /t 2 /nobreak >nul

:: ── Start client ───────────────────────────────
echo  Starting client on http://localhost:5173 ...
start "WR-Client" cmd /k "cd /d %~dp0client && npm run dev"

:: Give client 3 seconds to boot
timeout /t 3 /nobreak >nul

:: ── Open browser ───────────────────────────────
echo  Opening browser...
start http://localhost:5173

echo.
echo  ============================================
echo   Both services running.
echo   Server : http://localhost:3001
echo   Client : http://localhost:5173
echo   Close the two terminal windows to stop.
echo  ============================================
echo.
pause
