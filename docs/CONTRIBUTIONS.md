# 開発分担

この公開リポジトリは、非公開の開発元リポジトリから作成したポートフォリオ用スナップショットです。そのため、公開側のコミット履歴だけでは実装時の担当を追跡できません。以下は開発チームが確認した主担当と共同作業範囲です。

「主担当」は、その領域の設計または実装を中心となって進めた人を示します。レビュー、統合、展示向け調整は相互に行っており、ファイルの全行を一人だけが書いたという意味ではありません。

開発にはCodexとClaudeを生成AIエージェントとして使用しました。「主担当」には、AIへの指示、生成結果の採否・修正、実機検証、統合に対する責任も含みます。生成AIは共同制作者として数えず、開発上の最終判断と責任は人間2名が担いました。詳細は[`DEVELOPMENT_PROCESS.md`](DEVELOPMENT_PROCESS.md)を参照してください。

| 領域・主なファイル | 主担当 | 内容 |
|---|---|---|
| `src/main/remoteSessionClient.ts` | [maaakigai](https://github.com/maaakigai) | QRサーバー接続、WebSocket同期、HTTPフォールバック、再接続、ローカル継続 |
| `CloudServer/hakkei-score-server/` | maaakigai | QR登録、プレイヤー、セッション、スコア、ランキングのPythonサーバーとネットワーク設計 |
| `src/renderer/rankingStore.ts` | maaakigai中心・共同 | ローカルランキング、サーバー停止時の継続、共有ランキングとの切替 |
| `CloudServer/hakkei-score-server/README.md`、`docs/operation.md` | maaakigai | Linux / systemd、HTTPS、会場ネットワーク、監視、バックアップ、復旧、展示運用 |
| `tools/mocopi_ble_*.py` | [attack114514](https://github.com/attack114514) | BLEパケット調査、姿勢データ取得、再生・sidecar |
| `src/main/mocopiBleUdpReceiver.ts`、`src/main/mocopiBleAdapter.ts`、`src/main/bleSidecarManager.ts` | attack114514中心・共同 | mocopi 1台入力、角速度への変換、Main Processへの統合 |
| `src/renderer/punchCore.ts`、`src/renderer/scoreCalculator.ts` | attack114514中心・共同 | パンチ判定、スコア、損害額、ランク |
| `src/renderer/resultPresenter.ts`、`src/renderer/app.ts`、`src/renderer/styles.css`、`config/` | 共同（同程度） | 状態遷移、結果画面、UI、エフェクト、展示会場での演出・閾値調整 |
| `test/`、`docs/archive/development-runs/`、実機・負荷・継続稼働確認 | 共同 | 自動テスト、判断根拠、実機検証、展示前リハーサル |
| 研究室背景写真、Wan2.2 I2V映像 | attack114514中心・共同 | 共同制作者による背景写真の撮影。attack114514がWan生成操作、プロンプト、シード値を主に担当し、出力選定は2名で共同判断 |
| Critical専用映像 | 共同 | Geminiを用いた大型電波塔映像の制作、採用判断、ゲームへの統合 |
| 動画・音響素材の統合 | maaakigai中心・共同 | 動画・音響素材の配置、展示用SFXの切り出し、ループ、再生タイミングの調整。公開版の音声はすべて無音化 |
| 体験導線、会場ネットワーク、当日監視 | maaakigai中心・共同 | QRからプレイまでの導線と1時間展示の運用 |

RESTポーリング中心だった同期方式について、画面遷移時の不安定化を懸念し、実機で問題を観測してWebSocket優先方式を提案したのはmaaakigaiです。AIによる再実装後の採用と受入確認は2名で共同で行いました。

## メンターの関与

3名のメンターから、設計とmocopi 1台化の方針について助言を受けました。作品の開発責任、生成AI出力の受入判断、リリース判断は上記2名が担当しました。
