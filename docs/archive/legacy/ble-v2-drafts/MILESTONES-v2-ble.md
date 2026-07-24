# MILESTONES v2 (DRAFT) — mocopi BLE direct / magnitude-only

> ⚠ DRAFT・未権威。BLE probe GO 後に `MILESTONES.md` を本書ベースで権威化（旧 Unity/方向/M9–M16 表は完了履歴として残しつつ v2 を先頭へ）。
> 順序・Gate は `docs/drafts/SPEC-v2-ble-magnitude.md` / `docs/drafts/GATES-v2-ble.md` 準拠。Codex 実装順（spike → SPEC/AGENTS → packet → Main → Renderer → UI → build）に沿う。

## 0. 方針（過渡期）
- 旧 Unity gates は**凍結**（戻り道として削除しない）。`docs/runs/` は温存・索引化のみ。
- 本書は probe GO まで draft。No-Go なら A1/Unity fallback へ差し替え。

## 1. マイルストーン（Phase BLE・MVP）
> **MVP の唯一の定義は [MVP-v2.md](MVP-v2.md)**（主語＝mocopi 1台 BLE・keyboard は debug fallback）。下の V-series は Codex 調整版（input-independent contract を先に切る）。

| ID | サイズ | 作業 | 成果物 | 確認(Gate) |
|---|---:|---|---|---|
| V0 | S | **BLE probe スパイク**（実機・MVP の存在ゲート） | `tools/mocopi_ble_probe.py` 実測 | **Gate B**: 36byte/45-55Hz/静止比5x/再接続 |
| V1 | S | SPEC/AGENTS v2 権威化（BLE magnitude・AGENTS 非目標 上書き明記・旧を legacy 退避） | 新 `SPEC.md`/`AGENTS.md`/`docs/legacy/` | 各章が新方針と矛盾しない |
| V2 | S | **input-independent metrics contract**（`PunchInputSample`・Main 生成・keyboard/BLE adapter） | `src/shared` 型＋Main adapter | 型・契約が確定 |
| V3 | M | **keyboard core vertical slice**（=Debug Core・**MVP完成ではない**）。方向/hidden/idle/DominantHandCheck/Calibration軸 撤去 | stateMachine/score/video/result 縮小 | **Gate A/E(keyboard)**: keyboard で10連続完走・Lv変化 |
| V4 | M | **BLE sidecar → Main integration**（probe GO 後・bleak→UDP `mocopi-ble`→Main validator/metrics） | sidecar＋`src/main/*` | **Gate C**: BLE 経由で metrics が Renderer へ |
| V5 | M | Renderer magnitude-only game loop（Charge/HakkeiReady を accelEnergy 化・Calibration→baseline/gain） | `src/renderer/*` | **Gate D/E(BLE)**: 静止誤発火0・弱/強分離・BLE完走 |
| V6 | S | InputCheck BLE UI＋fallback（connected/Hz/baseline/accelEnergy・BLE断で keyboard debug） | UI | sidecar 停止で fallback・落ちない |
| V7 | S | 閾値チューニング（noiseFloor/punchThreshold を実機確定・config 反映） | config＋`docs/runs/` | 受入: 誤発火0/分離/latency≤300ms |
| V8 | S | demo readiness / 本番動画素材差し替え / 交代・再接続 runbook / 旧コード掃除 | build＋runbook＋cleanup | **Gate F**: 交代30s/10連続クラッシュ0 |

> **MVP 完成 = V0+V2+V3+V4+V5+V6 が通り、mocopi BLE 1台で「タメ→パンチ→動画Lv変化→Result」が10連続・静止誤発火0**（[MVP-v2.md](MVP-v2.md) Acceptance）。V1 は並走、V7/V8 は MVP 直後。

## 2. 不変（全 V を通じて維持）
- keyboard fallback 完走。Main が metrics 生成・Renderer 再計算なし。config 由来。エラーで落ちない。
- `docs/runs/` に各 V の判断理由・実測・未確認を残す。

## 3. 旧マイルストーン
- M0–M11 完了・両手v2 撤回・M15(§0.23 方向) は `MILESTONES.md`（旧表）に保持。v2 権威化時も**削除せず**「過去履歴」として残す。
