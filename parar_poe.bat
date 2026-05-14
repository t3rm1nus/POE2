@echo off
:: ============================================================
::  parar-poe2.bat
::  Mata todos los procesos node.exe (backend + frontend Vite).
::  Si tienes otros proyectos Node corriendo, también los para.
:: ============================================================
echo [PoE2] Parando servidores...
 
taskkill /F /FI "WindowTitle eq POE2-Backend*"  /T >nul 2>&1
taskkill /F /FI "WindowTitle eq POE2-Frontend*" /T >nul 2>&1
 
:: Por si usaste el VBS silencioso (sin título de ventana):
taskkill /F /IM node.exe /T >nul 2>&1
 
echo [PoE2] Servidores detenidos.
timeout /t 2 /nobreak >nul