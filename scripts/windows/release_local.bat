@echo off
cd /d "%~dp0\..\.."
set "PATH=%ProgramFiles%\nodejs;%PATH%"
echo === Building and launching Hakkei Lab Breaker (LOCAL MODE) ===
echo Server connection and phone features are disabled.
echo Player names are entered by keyboard; mocopi BLE remains the default input.
call npm run dev -- --local-mode
echo.
echo === Stopped. You can close this window. ===
pause
