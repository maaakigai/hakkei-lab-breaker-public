@echo off
if defined HAKKEI_ADMIN_TOKEN exit /b 0

for /f "usebackq delims=" %%T in (`powershell.exe -NoProfile -NonInteractive -Command "[Environment]::GetEnvironmentVariable('HAKKEI_ADMIN_TOKEN','User')"`) do set "HAKKEI_ADMIN_TOKEN=%%T"
exit /b 0
