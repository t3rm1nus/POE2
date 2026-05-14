@echo off
:: ============================================================
::  arrancar-poe2.bat
::  Levanta backend (Node) y frontend (Vite) en ventanas
::  minimizadas. Doble clic y listo.
:: ============================================================
cd /d "%~dp0"

echo [PoE2] Arrancando backend...
start "POE2-Backend" /MIN cmd /k "cd /d "%~dp0backend" && node src/index.js"

:: Damos 2 segundos para que el backend levante antes del frontend
timeout /t 2 /nobreak >nul

echo [PoE2] Arrancando frontend...
start "POE2-Frontend" /MIN cmd /k "cd /d "%~dp0frontend" && npm run dev"

echo.
echo  Backend  → http://localhost:3001
echo  Frontend → http://localhost:5173
echo.
echo  Las dos ventanas de terminal están minimizadas en la barra de tareas.
echo  Usa parar-poe2.bat para detener los servidores.
echo.
timeout /t 4 /nobreak >nul