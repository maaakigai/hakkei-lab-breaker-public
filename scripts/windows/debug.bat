@echo off
setlocal
cd /d "%~dp0\..\.."

set "NODE_DIR=%ProgramFiles%\nodejs"
if exist "%NODE_DIR%\npm.cmd" set "PATH=%NODE_DIR%;%PATH%"

set "NPM_CMD=npm.cmd"
if exist "%NODE_DIR%\npm.cmd" set "NPM_CMD=%NODE_DIR%\npm.cmd"

call "%NPM_CMD%" -v >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm.cmd was not found.
  echo Install Node.js 22.12 or newer, then run debug.bat again.
  echo.
  pause
  exit /b 1
)

echo === Building and launching Hakkei Lab Breaker (DEBUG UI) ===
call "%NPM_CMD%" run dev:debug
set "EXIT_CODE=%ERRORLEVEL%"
echo.
if not "%EXIT_CODE%"=="0" (
  echo [ERROR] Debug UI launch failed. Exit code: %EXIT_CODE%
  echo Check the error messages above.
  echo.
  pause
  exit /b %EXIT_CODE%
)

echo === Stopped. You can close this window. ===
pause
