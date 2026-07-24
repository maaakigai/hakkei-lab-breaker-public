# Contributions

この公開リポジトリは、非公開の開発元リポジトリから作成したポートフォリオ用スナップショットです。そのため、公開側のコミット履歴だけでは実装時の担当を追跡できません。以下は開発チームが確認した主担当と共同作業範囲です。

「主担当」は、その領域の設計または実装を中心となって進めた人を示します。レビュー、統合、展示向け調整は相互に行っており、ファイルの全行を一人だけが書いたという意味ではありません。

開発にはCodexとClaudeを生成AIエージェントとして使用しました。「主担当」には、AIへの指示、生成結果の採否・修正、実機検証、統合に対する責任も含みます。生成AIは共同制作者として数えず、開発上の最終判断と責任は人間2名が担いました。詳細は[`DEVELOPMENT_PROCESS.md`](DEVELOPMENT_PROCESS.md)を参照してください。

| 領域・主なファイル | 主担当 | 内容 |
|---|---|---|
| `src/main/remoteSessionClient.ts` | [maaakigai](https://github.com/maaakigai) | WebSocket同期、HTTPフォールバック、再接続、ローカル継続 |
| `CloudServer/hakkei-score-server/` | maaakigai | QR登録、プレイヤー、セッション、スコア、ランキングのPythonサーバー |
| `src/renderer/registered-users.ts`、`src/renderer/rankingStore.ts` | maaakigai中心・共同 | 登録済みユーザー導線、ローカルランキング、サーバー停止時の継続 |
| `CloudServer/hakkei-score-server/README.md`、`docs/operation.md` | maaakigai | Linux / systemd、HTTPS、監視、バックアップ、復旧、展示運用 |
| `tools/mocopi_ble_*.py` | [attack114514](https://github.com/attack114514) | BLEパケット調査、姿勢データ取得、再生・sidecar |
| `src/main/mocopiBleUdpReceiver.ts`、`src/main/mocopiBleAdapter.ts`、`src/main/bleSidecarManager.ts` | attack114514中心・共同 | mocopi 1台入力、角速度への変換、Main Processへの統合 |
| `src/renderer/punchCore.ts`、`src/renderer/scoreCalculator.ts`、`src/renderer/resultPresenter.ts` | attack114514中心・共同 | パンチ判定、スコア、損害額、ランク、リザルト |
| `src/renderer/app.ts`、`src/renderer/styles.css`、`config/` | 共同 | 状態遷移、UI、エフェクト、展示会場での演出・閾値調整 |
| `test/`、`docs/archive/development-runs/`、実機・負荷・継続稼働確認 | 共同 | 自動テスト、判断根拠、実機検証、展示前リハーサル |
| 研究室背景写真、AI生成破壊映像、タイトル・リザルト画面、ロゴ | attack114514中心・共同 | 共同制作者による背景写真の撮影、Wan2.2 I2Vでの生成、出力の選定・編集、画面表現 |
| 体験導線、会場ネットワーク、当日監視 | maaakigai中心・共同 | QRからプレイまでの導線と1時間展示の運用 |

## メンターの関与

3名のメンターから、設計とmocopi 1台化の方針について助言を受けました。作品の開発責任、生成AI出力の受入判断、リリース判断は上記2名が担当しました。
