# 公開版の実装要件

最終更新: 2026-07-24

Unity Bridgeを標準経路としていた旧要件は、[archive/legacy/requirements-unity-bridge.md](archive/legacy/requirements-unity-bridge.md) に移しました。

## 固定前提

- 本体はElectron / TypeScript / HTML / CSSで構成する。
- 通常入力はmocopiセンサー1個のBLE通知をPython sidecarで受け、ローカルUDPでElectron Mainへ渡す。
- RendererはMainが検証した `PunchInputSample` を消費し、BLEパケットを直接解析しない。
- キーボード入力は実機なしの確認と展示継続のため残す。
- Release版ではQR登録とランキング同期を有効にする。
- QR登録と展示機での名前手入力は、どちらも同じ共有ランキングへスコアを保存する。
- サーバー障害時もローカルモードでゲーム本体を続行できる。

## 体験要件

- `Ready → Charge → HakkeiReady → VideoPlayback → Result` を完走できる。
- チャージ量とパンチ強度からPower、損害額、ランク、動画レベルを決める。
- 公開版の動画は制作チーム作成の研究室内素材だけを使う。
- 実在企業を対象にした映像、追加抽選、専用演出は含めない。
- プレイヤーごとの操作を緩和する隠しモードは含めない。
- `R` と `Esc` で安全に復帰できる。

## 公開・権利要件

- BGMと効果音は無音の生成済みプレースホルダーにする。
- 公開MP4には音声ストリームを含めない。
- 素材区分を `ASSET_LICENSES.md`、第三者実装を `THIRD_PARTY_NOTICES.md` に記載する。
- 実ユーザー、ランキング、セッションの保存データ、秘密情報をリポジトリに含めない。

## セキュリティ要件

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`
- preloadでは必要なIPC APIだけを公開する。
- 外部ナビゲーションと新規ウィンドウを拒否する。

## 完了条件

- 型検査、静的解析、自動テスト、クリーンビルドが通る。
- mocopi BLEとキーボードの両方で手動完走できる。
- QR登録からResult通知まで、および名前手入力から共有ランキング保存までを実サーバーで確認できる。
- 音声・動画の素材検査が通る。
