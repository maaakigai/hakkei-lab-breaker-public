@echo off
cd /d "%~dp0\..\..\.."
set "PATH=%ProgramFiles%\nodejs;%PATH%"

echo ============================================
echo   発勁ラボブレイカー モックテスト 実機不要
echo ============================================
echo.
echo [1/3] ビルド中...
call npm run build
if errorlevel 1 (
  echo ビルドに失敗しました。終了します。
  pause
  exit /b 1
)
echo.
echo [2/3] mock Unity 送信器を別ウィンドウで起動します...
start "mock-unity" cmd /k node scripts\mock-unity.mjs
echo.
echo [3/3] 監視デーモンを起動します。
echo        検知したらゲームを mock モードで自動起動します...
echo.
node dist\automation\watcherMain.mjs --source mock-unity-bridge --debounce 3 --command node scripts\launch-electron.mjs --input-mode=mock-unity-bridge
echo.
echo === 終了しました。mock-unity ウィンドウは手動で閉じてください。 ===
pause
