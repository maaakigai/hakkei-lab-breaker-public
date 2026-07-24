@echo off
call "%~dp0_load-admin-token.bat"
cd /d "%~dp0\..\.."
npm run settings
pause
