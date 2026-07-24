@echo off
setlocal
call "%~dp0_load-admin-token.bat"
cd /d "%~dp0\..\.."

set "NODE_DIR=%ProgramFiles%\nodejs"
if exist "%NODE_DIR%\npm.cmd" set "PATH=%NODE_DIR%;%PATH%"

set "NPM_CMD=npm.cmd"
if exist "%NODE_DIR%\npm.cmd" set "NPM_CMD=%NODE_DIR%\npm.cmd"

call "%NPM_CMD%" -v >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm.cmd was not found.
  echo Install Node.js 22.12 or newer, then run registered-users.bat again.
  echo.
  pause
  exit /b 1
)

echo === Building and launching Registered Users GUI ===
call "%NPM_CMD%" run registered-users
set "EXIT_CODE=%ERRORLEVEL%"
echo.
if not "%EXIT_CODE%"=="0" (
  echo [ERROR] Registered Users GUI launch failed. Exit code: %EXIT_CODE%
  echo Check the error messages above.
  echo.
  pause
  exit /b %EXIT_CODE%
)

echo === Stopped. You can close this window. ===
pause
