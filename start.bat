@echo off
title YouTube Downloader (Local + Public Cloudflare Tunnel)
cd /d "%~dp0"

echo =======================================================
echo  Starting YouTube Downloader Server on port 3000...
echo =======================================================
start "YouTube Downloader Backend" cmd /k "node server.js"

timeout /t 2 /nobreak >nul

echo =======================================================
echo  Starting Cloudflare Public Tunnel...
echo =======================================================
start "Cloudflare Tunnel" cmd /k "cloudflared.exe tunnel --url http://localhost:3000"

echo.
echo -------------------------------------------------------
echo  Local URL:  http://localhost:3000
echo  Public URL: Check the Cloudflare Tunnel terminal window
echo -------------------------------------------------------
echo.
pause
