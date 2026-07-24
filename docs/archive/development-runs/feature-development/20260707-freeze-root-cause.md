# 2026-07-07 無音凍結バグ 根本原因の特定と修正

## 症状
発勁後に動画も Result も出ず、ラボ背景の静止画面で無音のまま凍結する（当初「130%チャージ＋強打（critical）で発生」と報告されたが、実際は非 critical の A ランクでも発生した）。

## 根本原因（状態遷移ログ logs/state-20260707.log で確定）
1. 起動時に `preloadConfiguredVideos()` が全 23 本の mp4 を一斉プリロードする。
2. Chromium はリソース保護のため、多数の画面外 `<video preload="auto">` の**データロードを一部保留**する。保留された要素は `readyState=1 (HAVE_METADATA)` のまま `loadeddata` / `canplay` / `error` の**いずれも発火しない**（実測: 起動 43 秒後に 23 本中 11 本が readyState=1 で停止）。
3. 旧 `videoManager.playVideo()` は「`loadeddata` を待ってから `play()`」する設計だったため、保留された要素に当たると `play()` が呼ばれず、`ended` も `error` も来ない → 状態機械が止まり無音凍結。
   - 動画は `.video-loading { opacity: 0 }` のまま＝ラボ背景の静止画面に見える。
4. どのファイルが保留されるかは非決定的なので不定期に発生。**アプリ起動直後の最初の数プレイが危険域**（プリロードがまだ全部終わっていない）。critical は動画を 2 本使うため相対的に踏みやすかった。

証拠ログ（凍結の実録）:
```
[VIDEO] mount: file=LV4/LV4_2.mp4 prepared=yes(rs=1)   ← データ未ロードの要素を掴んだ
[PROGRESS] rs:1, ns:2, t:0, paused:true                ← 30 秒間進行なし・イベントなし
[RECOVER] video-stall（30 秒 watchdog でタイトル復帰）
```

## 修正（videoManager.ts）
- `loadeddata` を待たず**即 `play()`** する。`play()` はロード保留中の要素のロードを強制再開させる。
- `timeupdate` / `playing` ベースの **stall 監視**を追加：進行が `app.config.json` の `video.stalledTimeoutMs`（2000ms）止まったら `onStalled` を発火。
- `app.ts` 側は `onStalled` で当該動画を諦めて `handleVideoEnded()` 相当で前へ進める。**スコアは確定済みなので Result は正常に表示される**（タイトルへ戻さない）。
- 既存の 30 秒タイトル復帰 watchdog は最終防衛線として残置。

## 検証
- `npm run typecheck` / `lint` / `test`（266 件）全緑。
- CDP 自動運転で キーボード12回・偽装BLE 7回、S ランク＋critical 含め全て Result 到達。
- 再生中の動画を外部から `pause()` して進行停止を人工再現 → 2 秒で `[VIDEO] stalled -> skip` → Result 到達を確認。

## 併せて実装（診断基盤）
- 状態遷移ログ: IPC `app:debug-log` → `logs/state-YYYYMMDD.log`。STATE/SCORE/VIDEO/PROGRESS/AUDIO/SESSION/RECOVER タグで、凍結時に DevTools なしで経緯を回収できる。

## 別途見つけた注意点（未対応・要検討）
- UDP 送信元が 2 つあると sessionId が交互に変わり `session-id-changed` が毎秒 50 回発火、livePlay 中は即 InputCheck に戻されゲーム不能になる。sidecar（python）の二重起動で実機でも起こり得る。受信側での sessionId ロック or sidecar の単一インスタンス保証を検討。
- `dispatch` の VideoPlayback 遷移で `prepareVideoForPlayback()` が ImpactDelay 入場時と合わせて 2 回呼ばれ、ラボ側 LV5 動画が再抽選される（実害なし・ログで確認可能）。
