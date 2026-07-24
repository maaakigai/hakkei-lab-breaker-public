@echo off
cd /d "%~dp0\..\..\.."
set "PATH=%ProgramFiles%\nodejs;%PATH%"

echo ============================================
echo   発勁ラボブレイカー 自動起動
echo ============================================
echo.
echo [1/3] ビルド中。初回は時間がかかります...
call npm run build
if errorlevel 1 (
  echo ビルドに失敗しました。終了します。
  pause
  exit /b 1
)
echo.
set "UNITYBRIDGE_EXE=unity-bridge\Build\UnityBridge.exe"
if exist "%UNITYBRIDGE_EXE%" (
  echo [2/3] UnityBridge.exe を起動します...
  start "UnityBridge" "%UNITYBRIDGE_EXE%"
) else (
  echo [2/3] 注意: UnityBridge.exe が見つかりません。部品1は未ビルドです。
  echo        Unity Editor を閉じてビルド後、次の場所に配置してください:
  echo            %UNITYBRIDGE_EXE%
)
echo.
echo ----- 人力ステップ: mocopiアプリ側で実施 -----
echo    1) QM-PR1接続 / センサーON / 装着
echo    2) ペアリング  3) キャリブレーション  4) 送信開始
echo ----------------------------------------------
echo.
echo [3/3] 監視デーモンを起動します。
echo        45100 で rightHandReady を検知したら、ゲームを
echo        Unity Bridge モードで自動起動します。検知まで待機します...
echo.
node dist\automation\watcherMain.mjs --source unity-bridge --debounce 3 --command node scripts\launch-electron.mjs --input-mode=unity-bridge
echo.
echo === 終了しました。ウィンドウを閉じて構いません。 ===
pause
