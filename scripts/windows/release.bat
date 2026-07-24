@echo off
cd /d "%~dp0\..\.."
set "PATH=%ProgramFiles%\nodejs;%PATH%"
echo === Building and launching Hakkei Lab Breaker (RELEASE UI) ===
call npm run dev
echo.
echo === Stopped. You can close this window. ===
pause
