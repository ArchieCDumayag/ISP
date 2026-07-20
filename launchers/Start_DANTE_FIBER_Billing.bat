@echo off
title DANTE FIBER BILLING SYSTEM - SERVER RUNNING
color 0B

echo ==========================================
echo        DANTE FIBER BILLING SYSTEM
echo ==========================================
echo.
echo Starting isolated Dante Fiber flavor...
echo Folder: C:\Users\LENOVO\Desktop\ISP
echo Local URL: http://localhost:3000
echo Public Tunnel: disabled
echo.
echo DO NOT CLOSE THIS WINDOW while using the system.
echo ==========================================
echo.

cd /d "C:\Users\LENOVO\Desktop\ISP"
call "C:\Program Files\nodejs\npm.cmd" run flavor:start -- dante-fiber --no-tunnel

pause
