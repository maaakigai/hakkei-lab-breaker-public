@echo off
setlocal
cd /d "%~dp0\..\.."
node scripts\mocopi-key-emulator.mjs %*
pause
