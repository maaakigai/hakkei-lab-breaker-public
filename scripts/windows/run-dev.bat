@echo off
cd /d "%~dp0\..\.."
set "PATH=%ProgramFiles%\nodejs;%PATH%"
echo === Building and launching Hakkei Lab Breaker (first run may take a while) ===
call npm run dev
echo.
echo === Stopped. You can close this window. ===
pause
