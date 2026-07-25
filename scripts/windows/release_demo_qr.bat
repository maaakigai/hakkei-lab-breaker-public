@echo off
cd /d "%~dp0\..\.."
set "PATH=%ProgramFiles%\nodejs;%PATH%"
echo === Building and launching Hakkei Lab Breaker (DEMO QR RECORDING) ===
echo This mode shows a non-working reserved QR and does not connect to the public server.
echo Use keyboard registration and controls to record the game flow.
call npm run dev -- --demo-qr
echo.
echo === Stopped. You can close this window. ===
pause
