@echo off
title ARCHIE FIBER BILLING SYSTEM - SERVER RUNNING
color 0B

echo ==========================================
echo        ARCHIE FIBER BILLING SYSTEM
echo ==========================================
echo.
echo Starting isolated Archie Fiber flavor...
echo Folder: C:\Users\LENOVO\Desktop\ISP
echo Local URL: http://localhost:3000
echo Public Tunnel: disabled
echo.
echo DO NOT CLOSE THIS WINDOW while using the system.
echo ==========================================
echo.

cd /d "C:\Users\LENOVO\Desktop\ISP"
call "C:\Program Files\nodejs\npm.cmd" run flavor:start -- archie-fiber --no-tunnel

pause
