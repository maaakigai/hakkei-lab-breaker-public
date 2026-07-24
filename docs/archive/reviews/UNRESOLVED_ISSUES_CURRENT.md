# UNRESOLVED_ISSUES_CURRENT.md

作成日: 2026-06-06

現時点のMarkdown資料群をもとに、未解決の懸念点・課題・問題点を一旦集約する。


> 2026-06-06更新: 本ファイルは未解決指摘の入力資料として保持します。実装・型・IPC・validator・状態遷移・Calibration・score・動画・Gate技術判定に現実的な影響がある指摘は、`docs/archive/reviews/UNRESOLVED_ISSUES_RESOLUTION_2026-06-06.md` と各Markdown資料へ反映済みです。運用、安全誘導、配布周辺だけの項目は今回の改善対象外です。

対象は、実装、型、IPC、validator、状態遷移、Calibration、score、Gate技術判定、テスト契約に直接影響するものに限定する。運用、安全、配布周辺だけの課題はここには含めない。ただし、資料上は安全・運用に見える項目でも、実装責務やGate技術判定を分岐させるものは対象に含める。

## 優先度定義

| 優先度 | 意味 |
|---|---|
| P0 | このまま実装すると構造や型が割れる可能性が高い |
| P1 | 実装者ごとの判断差、テスト期待値の不一致、Gate判定の揺れが起きる |
| P2 | 後続実装で迷いや手戻りを生むため、先に明文化した方がよい |

---

## 未解決問題一覧

### P0-01. Main / Renderer責務分担が資料間で衝突している

`SPEC.md` では、`MotionSample` はElectron Main Processで生成し、Rendererは速度、加速度、filter状態、`validForScore` を再計算しないと定義している。

一方、`AGENTS.md` ではRenderer責務に「平滑化、速度、加速度計算」が残っている。

根拠:

- `SPEC.md:434`
- `AGENTS.md:161-173`

実装影響:

- MainとRendererで速度・加速度・filterが二重実装される。
- `validForScore` / `validForCalibration` の判定責務が割れる。
- IPC testとscore unit testの前提が食い違う。

必要な解決:

- `SPEC.md` を正にするなら、`AGENTS.md` のRenderer責務から平滑化、速度、加速度計算を外す。
- Rendererは `MotionSample` を消費して状態遷移、score、UIを進める責務に限定する。

---

### P0-02. `AGENTS.md` のUDP JSON / MotionSample契約が古い

`AGENTS.md` のmotion / heartbeat JSON例には、現行 `SPEC.md` で必須の `protocolVersion`、`sessionId` などが不足している。

また、`AGENTS.md` の `MotionSample` 例には、`mock-unity-bridge`、`rawHandPosition`、`validForScore`、`validForCalibration` がない。

根拠:

- `AGENTS.md:197-249`
- `SPEC.md:265-348`
- `SPEC.md:461-482`

実装影響:

- Codexが `AGENTS.md` を優先して古い型を実装する可能性がある。
- `mock-unity-bridge` が正式sourceとして扱われない。
- Calibrationやscore除外判定に必要なfieldが欠ける。

必要な解決:

- `AGENTS.md` のJSON例と `MotionSample` 例を `SPEC.md` の現行型へ合わせる。
- `quality.flags` を自由文字列ではなく、`MotionQualityFlag` unionに合わせる。

---

### P0-03. `docs/requirements.md` が現行契約へ完全追従していない

`docs/archive/reviews/TARGETED_REVIEW_FIX_REPORT.md` では `docs/requirements.md` を現行契約に合わせたとされているが、実際には古い責務や型が残っている。

根拠:

- `docs/archive/reviews/TARGETED_REVIEW_FIX_REPORT.md:30`
- `docs/requirements.md:292-334`
- `docs/requirements.md:486-496`
- `SPEC.md:434`
- `SPEC.md:461-482`

実装影響:

- 判断順位上、`docs/requirements.md` を根拠にするとRenderer側で速度・加速度計算を実装しやすい。
- `MotionSample` の `validForScore` / `validForCalibration` が最上位要件から漏れる。

必要な解決:

- `docs/requirements.md` の責務表、処理フロー、`MotionSample` 例を `SPEC.md` に合わせる。
- 要件文書側にも「速度・加速度・filter・validityはMain生成の `MotionSample` を正とする」と明記する。

---

### P0-04. HakkeiReady timeoutの意味が衝突している

`docs/archive/reviews/DOC_REVIEW_ALL_FINDINGS_RESOLUTION_REPORT.md` では、score反映領域として `timeout no-impact` を反映済みとしている。

一方、現行 `SPEC.md`、`MILESTONES.md`、`HUMAN_TEST_GUIDE_JA.md` では、HakkeiReady timeoutを「弱発勁」として扱う記述が残っている。

根拠:

- `docs/archive/reviews/DOC_REVIEW_ALL_FINDINGS_RESOLUTION_REPORT.md:27`
- `SPEC.md:825`
- `MILESTONES.md:127`
- `MILESTONES.md:258`
- `HUMAN_TEST_GUIDE_JA.md:261`

実装影響:

- timeout時に `hakkeiDetected=true` 扱いにするか、`hakkeiDetected=false` / `hakkeiScore=0` にするかが割れる。
- Lv0動画、impact音、Result表示、静止誤検出テストの期待値が変わる。

必要な解決:

- timeoutを「no-impact」とするか「弱発勁」とするかを1つに固定する。
- `ScoreBreakdown` に `hakkeiDetected`、`hakkeiTimedOut`、`hakkeiScore` の整合条件を追加する。

---

### P0-05. Mock Unity Bridge手順がsource排他仕様と噛み合っていない

`HUMAN_TEST_GUIDE_JA.md` のMock確認では、入力モードを `Unity Bridge` にしてmock送信すると書かれている。

しかし `SPEC.md` では `mock-unity-bridge` は独立した `InputMode` / `MotionSource` であり、active sourceとpacket sourceが混ざる場合は `SOURCE_MISMATCH` になる。

根拠:

- `HUMAN_TEST_GUIDE_JA.md:359-363`
- `SPEC.md:116`
- `SPEC.md:537`
- `SPEC.md:1252`

実装影響:

- Mock確認が仕様通りに失敗する可能性がある。
- 実装者がMockを `unity-bridge` sourceとして送るか、activeModeの排他を緩めるかで分岐する。

必要な解決:

- Mock確認時は入力モードを `Mock Unity Bridge` にする、と手順を修正する。
- もし `Unity Bridge` modeでmockを受ける設計にするなら、`source` と `activeMode` の対応規則を明文化する。

---

### P0-06. Gate B2がMockだけでも通るように読める

`SPEC.md` のGate B2条件に「Unity BridgeまたはMock Unity BridgeのUDP JSONを受信できる」とある。

Gate名は「Unity Bridge入力成立」なので、MockだけでGate B2を通せるのか、Mockは事前テストなのかが曖昧。

根拠:

- `SPEC.md:1383-1390`
- `HUMAN_TEST_GUIDE_JA.md:341-353`
- `HUMAN_TEST_GUIDE_JA.md:532-552`

実装影響:

- Gate B2の判定が人によって割れる。
- 実Unity Bridge未確認のまま後続Gateへ進む可能性がある。

必要な解決:

- Gate B2は実 `unity-bridge` 必須とする。
- MockはGate B2前のvalidator / IPC開発確認として別条件に分ける。

---

### P0-07. `rightHand` 欠損時の扱いが矛盾している

`UnityMotionPacketV1` では `rightHand` が必須になっている。

一方で、`isTracked=false` または `avatar.hasRightHand=false` のmotionは破棄せず `isAvailable=false` の `MotionSample` を作ると書かれている。

根拠:

- `SPEC.md:319-332`
- `SPEC.md:344`
- `SPEC.md:348`

実装影響:

- RightHand未取得時にpacketをinvalidにするのか、unavailable sampleにするのかが割れる。
- `RIGHT_HAND_UNAVAILABLE` の表示とscore/calibration除外テストが不安定になる。

必要な解決:

- `isTracked=false` / `avatar.hasRightHand=false` の場合に `rightHand` 省略を許すかどうかを明記する。
- 省略を許すなら、`rawHandPosition` / `handPosition` の保持値、初回値、flagsを固定する。

---

### P0-08. `sourceStatuses.unknown` が型で表現できない

`SPEC.md` はparse前にsourceが分からないpacketを `sourceStatuses.unknown` またはglobal invalid countへ入れるとしている。

しかし `MotionStatusPayload.sourceStatuses` は `Record<MotionSource, SourceStatusSnapshot>` であり、`unknown` keyを持てない。global invalid countもpayloadにない。

根拠:

- `SPEC.md:426`
- `SPEC.md:613-637`

実装影響:

- parse前エラー、巨大JSON、source不明packetのcount表示が実装者任せになる。
- `INVALID_JSON` / `JSON_TOO_LARGE` のテストでstatus確認が割れる。

必要な解決:

- `globalInvalidPacketCount` などのtop-level fieldを追加する。
- もしくは `sourceStatuses` のkey型に `"unknown"` を含める。

---

### P0-09. 設定schemaと設定例が一致していない

`InputConfig` は `schemaVersion`、`maxDatagramBytes`、`keyboard` を必須にしているが、`input.config.json` 例にはない。

`ScoreConfig` も `schemaVersion` 必須だが、`score.config.json` 例にはない。

根拠:

- `SPEC.md:702-716`
- `SPEC.md:718-724`
- `SPEC.md:1288-1318`
- `SPEC.md:1323-1359`

実装影響:

- 仕様通りのvalidatorを作ると、仕様内のサンプルconfigが `CONFIG_INVALID` になる。
- 逆にサンプルを通すと、schemaの必須性が崩れる。

必要な解決:

- config例をschemaに合わせて更新する。
- もしくはschemaから不要必須fieldを外す。

---

### P0-10. 座標補正configがschemaに存在しない

`rawHandPosition` は `axisMapping` と `scaleMultiplier` 適用後とされている。

しかし `InputConfig` には座標補正schemaがない。`MILESTONES.md` では軸反転/入替設定を入れる作業があるが、設定名と構造が未定義。

根拠:

- `SPEC.md:489`
- `SPEC.md:702-716`
- `MILESTONES.md:213`

実装影響:

- 軸反転、軸入替、scale補正の設定名が実装者任せになる。
- Calibration、右手上下/前後確認、Gate C/D1の判定に影響する。

必要な解決:

- `InputConfig` に `coordinates` または同等のschemaを追加する。
- `axisMap`、`sign`、`scaleMultiplier`、warning/invalid範囲の名前を固定する。

---

### P1-01. `StatusWarning` の固定文言・発火条件がない

`StatusWarning` は `messageJa` を必須にしているが、`UNKNOWN_FIELDS`、`SEQ_GAP`、`JITTER_WARN` などの固定文言と発火条件表がない。

根拠:

- `SPEC.md:539-563`
- `SPEC.md:1238-1261`

実装影響:

- `StatusWarningCode` は固定されても表示文言が実装者ごとに変わる。
- Human guideやテストでwarning表示をassertしづらい。

必要な解決:

- `StatusWarningCode` ごとの `messageJa`、集約scope、clear条件、count更新条件を表にする。

---

### P1-02. `MotionDiagnosticsPayload` が入力未選択状態を表せない

`MotionDiagnosticsPayload.source` は `MotionSource` 必須になっている。

起動直後の `activeMode="none"`、入力未選択、source不明のdiagnosticsを表現できない。

根拠:

- `SPEC.md:665-677`
- `SPEC.md:537`

実装影響:

- InputCheckで常時diagnosticsを表示する場合、dummy sourceを入れるか送信しないかで実装が割れる。
- `motion:diagnostics` の購読側がnull状態を扱えない。

必要な解決:

- `source: MotionSource | null` にする。
- `activeMode` もdiagnostics payloadへ入れるか、statusと併用する前提を明記する。

---

### P1-03. Calibration品質条件が実装可能な粒度まで落ちていない

Resolution Reportでは、Calibrationのraw座標使用、filter reset、300ms discard、2秒/1秒条件、forward距離、破棄条件を反映済みとしている。

しかし `SPEC.md` のCalibration章には、sample数、最低Hz、discard、forward距離、session変更時の破棄、RightHand消失時の破棄などがない。

さらに `MILESTONES.md` では3秒静止、`HUMAN_TEST_GUIDE_JA.md` では2秒静止になっている。

根拠:

- `docs/archive/reviews/DOC_REVIEW_ALL_FINDINGS_RESOLUTION_REPORT.md:26`
- `SPEC.md:866-888`
- `MILESTONES.md:210`
- `HUMAN_TEST_GUIDE_JA.md:576`

実装影響:

- Calibration成功条件が実装者任せになる。
- Gate C/D1の前方向判定、score積算、jitter評価が不安定になる。

必要な解決:

- neutral / forwardの時間、sample数、Hz、discard、forward距離、破棄条件を `SPEC.md` に明記する。
- `MILESTONES.md` と `HUMAN_TEST_GUIDE_JA.md` を同じ条件へ合わせる。

---

### P1-04. `seq` 重複時の扱いが未定義

`seq` 欠損、rollback、gapは定義されているが、`seq === previousSeq` の重複packetをどう扱うかがない。

根拠:

- `SPEC.md:339-342`
- `SPEC.md:1272`

実装影響:

- 重複packetを受理してMotionSampleを二重生成する実装と、invalidにする実装が分かれる。
- droppedFrameCount、lastSeq、status warningの期待値が割れる。

必要な解決:

- `seq === previousSeq` はduplicateとしてinvalidにする、など固定する。
- 必要なら `SEQ_DUPLICATE` code/flagを追加するか、`SEQ_ROLLBACK` に含めるかを決める。

---

### P1-05. `IpcResult<void>` の成功形が曖昧

`IpcResult<T = void>` は成功時に常に `value: T` を要求している。

一方、`keyboard:control`、`calibration:set-state`、`input:reset-filter` などは `IpcResult` のみで、成功時に `value: undefined` を入れるのか、`value` なしを許すのかが曖昧。

根拠:

- `SPEC.md:591-593`
- `SPEC.md:754-762`
- `SPEC.md:770-777`

実装影響:

- IPC unit testの期待payloadが割れる。
- preload APIの型実装で `void` 成功レスポンスの扱いがぶれる。

必要な解決:

- `IpcResult<void>` では `{ ok: true }` を許す型にする。
- もしくは全void系IPCに明示的なresponse valueを定義する。

---

### P1-06. `app:error-clear` と `app:error:clear` が併存している

Main -> Rendererのeventは `app:error-clear`。

Renderer -> Mainのrequestは `app:error:clear`。

意図的に分けるなら命名規則が必要だが、現状は取り違えやすい。

根拠:

- `SPEC.md:686`
- `SPEC.md:761`
- `SPEC.md:777`
- `SPEC.md:1280`

実装影響:

- IPC handler名、preload method、test名で混同が起きる。
- `app:error-clear` の送受信方向がレビューで追いにくい。

必要な解決:

- channel命名を統一する。
- もしくは `app:error-clear` はevent、`app:error:clear` はcommandという規則を明記する。

---

### P1-07. `rank` 算出条件がない

`ScoreBreakdown.rank` は必須だが、rank thresholdが定義されていない。

根拠:

- `SPEC.md:1119-1127`
- `MILESTONES.md:277`

実装影響:

- rank表示が実装者ごとの仮値になる。
- Result fixture、境界値テスト、human testで期待値を固定できない。

必要な解決:

- `ScoreConfig` に `rankThresholds` を追加する。
- rank境界、ソート順、境界値の包含規則を固定する。

---

### P1-08. jitter指標の名称とwindowがまだ揺れている

Gate D1では2秒windowの `rawJitterRms2s` / `filteredJitterRms2s` などを使う。

しかし `SPEC.md` の実機確認条件では `jitterRms3d` / `jitterMax3d`、`HUMAN_TEST_GUIDE_JA.md` の記録欄では `filteredJitterRms3s` / `drift3s` が残っている。

根拠:

- `SPEC.md:977-990`
- `SPEC.md:1409-1416`
- `SPEC.md:1437-1438`
- `HUMAN_TEST_GUIDE_JA.md:56-58`

実装影響:

- 実測ログとGate判定値の名前・windowが一致しない。
- diagnostics UIやchecklistの表示名が割れる。

必要な解決:

- 2秒windowの名称に統一する。
- 3D magnitudeという意味を残したい場合は、`rawJitterRms2s` の定義に「3D vector norm」と明記する。

---

### P1-09. 異常系mock scriptの契約が弱い

`AGENTS.md` の例では `mock:unity:heartbeat-stall` を確認に使っている。

しかし、必須scriptとして定義されているのは主に `mock:unity` だけで、seq gap、timestamp rollback、huge JSON、heartbeat stallなどの異常系script名は統一されていない。

根拠:

- `AGENTS.md:311-316`
- `AGENTS.md:354`
- `MILESTONES.md:159`
- `HUMAN_TEST_GUIDE_JA.md:693-700`

実装影響:

- validator / Error固定表を自動確認できない。
- 人間確認やCodex実装ごとにscript名が割れる。

必要な解決:

- `package.json` に予約するmock script名を `SPEC.md` または `MILESTONES.md` で固定する。
- `mock:unity:seq-gap`、`mock:unity:seq-missing`、`mock:unity:timestamp-rollback`、`mock:unity:heartbeat-stall`、`mock:unity:huge-json` などを明示する。

---

### P1-10. フェーズ開始直後の初回valid sample扱いが未定義

VerticalCharge / ForwardChargeでは、フェーズ開始直後の最初のvalid sampleを基準位置として保存し、積算しないルールが見当たらない。

根拠:

- `SPEC.md:803-804`
- `SPEC.md:1034-1047`

実装影響:

- 前フェーズ末尾から次フェーズ初回sampleまでの差分がscoreに混ざる。
- reset直後やmode切替直後にスコアが跳ねる。

必要な解決:

- 各charge phaseの最初の `validForScore=true` sampleはbaseline化し、積算しないと明記する。

---

### P1-11. 10秒タイマーのclock基準が未定義

VerticalCharge / ForwardChargeは10秒と定義されているが、Renderer `performance.now()`、Main clock、sample timestampのどれを基準にするかが固定されていない。

根拠:

- `SPEC.md:803-804`
- `MILESTONES.md:125-126`
- `HUMAN_TEST_GUIDE_JA.md:220-244`

実装影響:

- 入力Hz低下、sample停止、window blur時のフェーズ進行が実装者ごとに変わる。
- e2e testのtimer期待値が割れる。

必要な解決:

- 状態遷移タイマーはRendererの `performance.now()` 基準など、単一基準に固定する。
- sample timestampはscore計算のdtにだけ使う、など役割を分ける。

---

### P1-12. Debug Fixtureの名前と扱いが揺れている

`SPEC.md` では `Debug Result Fixture`、`docs/archive/reviews/VALIDATION_REPORT.md` や `HUMAN_TEST_GUIDE_JA.md` では `Debug Score Fixture` という名前が使われている。

また、`SPEC.md` では通常プレイ入力モードではないと明記しているが、`HUMAN_TEST_GUIDE_JA.md` の記録欄では入力モードの選択肢に入っている。

根拠:

- `SPEC.md:117-119`
- `SPEC.md:1130`
- `docs/archive/reviews/VALIDATION_REPORT.md:14`
- `docs/archive/reviews/VALIDATION_REPORT.md:29`
- `HUMAN_TEST_GUIDE_JA.md:51`
- `HUMAN_TEST_GUIDE_JA.md:729`

実装影響:

- Titleの入力モードとして実装される可能性がある。
- 通常play pathにfixtureが混入する可能性がある。
- route名、component名、test名が割れる。

必要な解決:

- 名称を1つに統一する。
- 入力モードではなくDiagnostics/Dev menu機能であると手順側にも明記する。

---

### P1-13. Debug FixtureでPower直指定を許すかが曖昧

`SPEC.md` と `HUMAN_TEST_GUIDE_JA.md` は、Debug Fixtureで `ScoreBreakdown` または `power` fixtureを使ってよいとしている。

一方で、通常score検証では `MotionSample` から `ScoreBreakdown` を計算することが重視されている。Power直指定を許すと、`calculatePowerFromScores()` やScoreBreakdown整合性を迂回するテストができてしまう。

根拠:

- `SPEC.md:1130`
- `HUMAN_TEST_GUIDE_JA.md:729`
- `docs/archive/reviews/DOC_REVIEW_ALL_FINDINGS_RESOLUTION_REPORT.md:27`

実装影響:

- 動画selector単体確認とscore計算確認の区別が曖昧になる。
- Result fixtureが通常score pathを保証しない。

必要な解決:

- Debug Fixtureを2種類に分ける。
  - video selector単体確認: power直指定可
  - Result / ScoreBreakdown確認: vertical / forward / hakkeiから `calculatePowerFromScores()` を通す
- 通常プレイに混ぜない制約を明記する。

---

### P2-01. `maxDatagramBytes` の値がschema必須なのに設定例から欠けている

これはP0-09の一部だが、`JSON_TOO_LARGE` の固定条件が `maxDatagramBytes` に依存するため、個別に注意が必要。

根拠:

- `SPEC.md:258`
- `SPEC.md:707`
- `SPEC.md:1246`
- `SPEC.md:1290-1297`

実装影響:

- huge JSON testの境界値が実装者任せになる。

必要な解決:

- `input.config.json` 例に `maxDatagramBytes: 8192` を追加する。
- 4096に戻す場合は全資料を合わせる。

---

### P2-02. `validSampleRatio` のphase別保持先が弱い

`MotionDiagnosticsPayload` は単一の `validSampleRatio` だけを持つが、Gate D1ではVertical / Forward / HakkeiReady別の比率を要求している。

根拠:

- `SPEC.md:665-675`
- `SPEC.md:990`
- `SPEC.md:1409`
- `docs/verification_checklist.md:56-58`

実装影響:

- Gate D1記録でphase別比率をどこから取るかが曖昧になる。
- Result payloadやrun logが別途必要になる。

必要な解決:

- diagnosticsに `validSampleRatioByPhase` を追加する。
- もしくはResult/run log側にphase別値を必須として定義する。

---

## 追加未解決問題一覧（2026-06-06追記）

以下は、上記一覧に未記載だった追加懸念。運用・安全・配布周辺は除外し、実装、型、validator、状態遷移、score、動画、テスト期待値に現実的な影響があるものに限定する。

### P0-11. score / hakkei が `validForScore` を必ず見る契約が弱い

`MotionSample.validForScore` は定義されているが、発勁検出条件は `MotionSample.isAvailable == true` だけを要求している。

また、上下チャージ / 前後チャージの積算式でも `validForScore=true` のsampleだけを使うとは明記されていない。

根拠:

- `SPEC.md:491`
- `SPEC.md:1009-1013`
- `SPEC.md:1034-1047`

実装影響:

- `DT_TOO_SMALL`、`DT_TOO_LARGE`、`OUTLIER_*` 付きsampleがscoreや発勁判定に混ざる可能性がある。
- Mainで `validForScore=false` を作っても、Renderer側のscore / hakkei実装が `isAvailable` だけを見てしまう。
- 静止誤検出、欠落直後のscore跳ね、Gate D1のvalidSampleRatio判定と実プレイscoreの乖離が起きる。

必要な解決:

- 上下チャージ、前後チャージ、発勁検出、HakkeiScore算出は `validForScore=true` のsampleだけを使うと明記する。
- `isAvailable=true` だが `validForScore=false` のsampleはdiagnosticsには出すがscore/hakkeiには使わない、と固定する。

---

### P0-12. dt異常・外れ値の「破棄 / invalid sample化 / clamp」が未固定

`minDtMs` は「捨てる」、`maxDtMs` は「サンプル欠落扱い」、加速度異常は「clampまたは破棄」と読める。

一方で、`MotionQualityFlag`、`droppedFrameCount`、`validSampleRatio`、diagnosticsは、異常sampleを何らかの形で数えることを前提にしている。

根拠:

- `SPEC.md:445-481`
- `SPEC.md:937-941`
- `SPEC.md:990`
- `MILESTONES.md:200-203`

実装影響:

- `DT_TOO_SMALL` や `OUTLIER_ACCELERATION` のときに `MotionSample` を出す実装と、完全破棄する実装が分かれる。
- `validSampleRatio` の分母、invalidPacketCount、droppedFrameCount、quality flagsの期待値が割れる。
- clampする場合、scoreにclamp済みの強い加速度が残り、破棄する場合とHakkeiScoreが変わる。

必要な解決:

- dt異常、position jump、velocity outlier、acceleration outlierごとに「packet破棄」「sample生成して `validForScore=false`」「clampして `validForScore=true/false`」のどれかを固定する。
- `validSampleRatio` の分母に含める対象と、`droppedFrameCount` の加算条件を表にする。

---

### P1-14. common field不正時のError codeが足りない

`protocolVersion`、`type`、`source`、`sessionId` の共通fieldを検証するとあるが、`protocolVersion` 不一致、`source` 不正、`sessionId` 不正に対応する固有の `AppErrorCode` がない。

validator順序では「`UNKNOWN_PACKET_TYPE` または該当packetのinvalid code」とされているが、type判定前の共通field不正では該当packet種別が確定しない場合がある。

根拠:

- `SPEC.md:281-285`
- `SPEC.md:567-589`
- `SPEC.md:1267-1271`

実装影響:

- `protocolVersion=2`、`source="foo"`、空 `sessionId` などのテスト期待codeが実装者ごとに割れる。
- `UNKNOWN_PACKET_TYPE` がtype不明以外にも使われ、Error表示と原因切り分けが曖昧になる。

必要な解決:

- `INVALID_BRIDGE_PACKET`、`UNSUPPORTED_PROTOCOL_VERSION`、`INVALID_PACKET_SOURCE`、`INVALID_SESSION_ID` などを追加する。
- 追加しない場合は、共通field不正をすべて `INVALID_MOTION_PACKET` / `INVALID_HEARTBEAT_PACKET` / `UNKNOWN_PACKET_TYPE` のどれに寄せるか、判定順序ごとに固定する。

---

### P1-15. `app:error` のseverityと画面遷移の対応が未定義

`AppErrorSeverity` は `warning` / `error` / `fatal` に分かれているが、どのseverityでError画面へ遷移するか、どれをdiagnostic表示に留めるかが固定されていない。

Human guideでは、不正JSONはError画面へ強制遷移しない、動画欠落はErrorへ行く、という想定が読める。

根拠:

- `SPEC.md:565`
- `SPEC.md:647-655`
- `SPEC.md:799-809`
- `SPEC.md:1238-1261`
- `HUMAN_TEST_GUIDE_JA.md:407-417`
- `HUMAN_TEST_GUIDE_JA.md:712-719`

実装影響:

- validator warningでプレイ画面を止める実装と、status panelだけに出す実装が分かれる。
- `VIDEO_MISSING`、`SCORE_INVALID`、`CONFIG_INVALID` の復帰導線とテスト期待が揺れる。
- Error画面遷移時に状態を破棄するか、一時停止するかが不明になる。

必要な解決:

- severityごとに、Error画面へ遷移するか、diagnostic表示に留めるか、現在stateを維持するかを固定する。
- `warning` は原則status/diagnostic、`error` はゲーム進行不能時のみError、`fatal` は起動停止など、状態遷移表へ反映する。

---

### P1-16. Keyboard / MockのCalibration経路がまだ割れる

`SPEC.md` の状態遷移では、Keyboard入力は `InputCheck -> Ready` へ直接進む。

一方で、Human guideではKeyboardモードにもCalibration画面があり、MilestonesにはKeyboard用疑似Calibrationを作る作業がある。Mock Unity BridgeがCalibrationを通るかどうかも明示されていない。

根拠:

- `SPEC.md:817-820`
- `HUMAN_TEST_GUIDE_JA.md:184-200`
- `MILESTONES.md:215`

実装影響:

- KeyboardでCalibration画面を表示する実装と、完全にskipする実装が分かれる。
- `calibration: 実施済み` 表示、Ready到達条件、Gate A/D2の手順が揺れる。
- Mock Unity Bridgeの通常score経路確認で、Calibrationを実施するか疑似値を入れるかが実装者任せになる。

必要な解決:

- `InputMode` ごとのCalibration経路を固定する。
- Keyboardは疑似Calibrationを自動完了してReadyへ進む、Mock Unity BridgeはUnity Bridgeと同じCalibrationを通る、など明文化する。

---

### P1-17. Enterが直接発勁イベントになる余地が残っている

`SPEC.md` は、Enter押下時にMainが疑似 `MotionSample` 列を生成し、通常のHakkei判定条件を満たした場合だけ `ImpactDelay` へ進む、としている。

一方、`MILESTONES.md` では「Enterで発勁イベントを出す」「HakkeiReadyでEnterに反応する」と読める。

根拠:

- `SPEC.md:509`
- `MILESTONES.md:121`
- `HUMAN_TEST_GUIDE_JA.md:254-266`

実装影響:

- Keyboard経路だけ `hakkeiDetector` を迂回してImpactDelayへ進む実装になり得る。
- Gate D2の「Keyboard由来 `MotionSample` が通常Hakkei判定を通る」という条件と衝突する。

必要な解決:

- `MILESTONES.md` のM2-06を「Enterで疑似MotionSample列を生成する」に寄せる。
- Human guideにも「Enterは直接遷移ではなく、疑似突き入力として通常判定を通る」と明記する。

---

### P1-18. `forwardVector` の採用優先順位が未固定

`forwardVector` は、AvatarのforwardまたはCalibration時の指示動作から推定、とされている。

どちらを優先するか、両方ある場合の上書き条件、推定品質が低い場合のfallbackが固定されていない。

根拠:

- `SPEC.md:878`
- `docs/requirements.md:683`
- `HUMAN_TEST_GUIDE_JA.md:470`
- `MILESTONES.md:213`

実装影響:

- 前後チャージと発勁判定の方向が実装ごとに変わる。
- 前後が逆の場合、Calibrationで直すのか、軸反転設定で直すのか、Avatar forwardを直すのかが分かれる。
- Gate C/D1で同じ動作をしてもscoreや発勁検出が一致しない。

必要な解決:

- `forwardVector` の決定順序を固定する。例: Calibration指示動作が品質条件を満たせばそれを採用、満たさなければAvatar forward、最後にconfig override。
- 採用元をdiagnosticに表示し、手動確認で見られるようにする。

---

### P1-19. unavailable / invalid から復帰した直後のbaseline resetが未固定

`isTracked=false` や `avatar.hasRightHand=false` のときは、`handPosition` に直前の有効filtered値を保持するとされている。

しかし復帰直後に `p_t - p_{t-1}` をそのままscore積算へ使うか、復帰sampleをbaseline化して積算しないかが未定義。

根拠:

- `SPEC.md:348`
- `SPEC.md:458`
- `SPEC.md:491`
- `SPEC.md:1034-1047`

実装影響:

- トラッキング消失中に手が動いた場合、復帰時に大きな差分が一括で上下/前後scoreへ入る可能性がある。
- `RECOVERED_FROM_UNAVAILABLE` flagがあっても、score除外条件がないと効果がない。
- Gate D1のvalidSampleRatioは満たしても、実プレイscoreが跳ねる。

必要な解決:

- `RECOVERED_FROM_UNAVAILABLE`、`DT_RESET`、session change、mode change直後の最初のvalid sampleはbaseline化し、score積算とHakkei判定に使わないと明記する。
- このルールをphase開始直後baseline化ルールと同じ扱いにする。

---

### P1-20. HakkeiScoreの評価窓が「直近または直後」で非決定的

HakkeiScoreは「発勁検出後、直近または直後の短時間窓からピーク値を取る」とされている。

検出前200ms、検出後200ms、検出時刻を中心にしたwindowのどれを使うかで、速度・加速度・移動量のピークが変わる。

根拠:

- `SPEC.md:1023`
- `SPEC.md:1054-1058`
- `SPEC.md:1076-1088`

実装影響:

- `hakkeiDetector` unit testと `scoreCalculator` unit testのfixture期待値が割れる。
- ImpactDelayへ入った後もsampleを待ってscoreを確定する実装と、検出時点で即確定する実装が分かれる。
- Keyboard Enter疑似入力200msとの整合も揺れる。

必要な解決:

- 検出判定用windowとscore算出用windowを分けるか、同一にするか固定する。
- 例: 検出時点までの直近 `hakkeiWindowMs` だけでHakkeiScoreを確定し、検出後sampleは使わない。

---

### P1-21. config型が `Record<string, number>` で必須キーと範囲を表現できない

`InputConfig.filter`、`InputConfig.jitter`、`InputConfig.keyboard`、`ScoreConfig.normalization`、`ScoreConfig.hakkei`、`ScoreConfig.power` が `Record<string, number>` になっている。

一方で、仕様本文とconfig例は多数の必須キーと範囲制約を前提にしている。

根拠:

- `SPEC.md:713-715`
- `SPEC.md:718-724`
- `SPEC.md:1288-1359`

実装影響:

- TypeScript型だけでは `verticalRawMax` 欠損、`powerCoefficient` 欠損、EMA alpha範囲外などを表現できない。
- validator実装が資料外の暗黙schemaになりやすい。
- `CONFIG_INVALID` の境界値テストが固定しづらい。

必要な解決:

- `FilterConfig`、`JitterConfig`、`KeyboardConfig`、`ScoreNormalizationConfig`、`HakkeiConfig`、`PowerConfig` を具体型として定義する。
- 各fieldの必須性、単位、許容範囲、大小関係を表にする。

---

### P2-03. video timeoutのgrace値と設定場所がない

`VIDEO_STALLED` は2秒以上 `currentTime` が進まない場合、`VIDEO_ENDED_TIMEOUT` はexpected duration + grace超過とされている。

しかし、grace値、stall秒数の設定場所、HTML videoのdurationが取れない場合の扱いが未定義。

根拠:

- `SPEC.md:1255-1256`
- `SPEC.md:718-724`
- `SPEC.md:1154-1170`

実装影響:

- videoManagerのE2E testでtimeout期待値が割れる。
- 短い仮動画、duration metadataが遅れて入る動画、loop/endedイベント遅延で誤Errorになる可能性がある。

必要な解決:

- `score.config.json` か `app.config.json` に `videoStallTimeoutMs`、`videoEndedGraceMs` を追加する。
- durationが `NaN` / `Infinity` の場合のfallback timeoutを固定する。

---

### P2-04. `UNITY_BRIDGE_TIMEOUT` がmotion timeoutとheartbeat timeoutを混同し得る

`UNITY_BRIDGE_TIMEOUT` の固定条件は「active sourceのmotion/heartbeatが `heartbeatTimeoutMs` 以上来ない」と読める。

しかし status snapshotは `lastMotionAtMs` と `lastHeartbeatAtMs`、`motionHz` と `heartbeatHz` を分けて持っている。

根拠:

- `SPEC.md:617-620`
- `SPEC.md:1240`
- `SPEC.md:1389`
- `SPEC.md:1408`

実装影響:

- heartbeatだけ止まった場合、motionだけ止まった場合、両方止まった場合のwarning/errorが同じになる。
- `LOW_SAMPLE_RATE`、`UNITY_BRIDGE_TIMEOUT`、`RIGHT_HAND_UNAVAILABLE` の優先表示が実装者ごとに変わる。
- InputCheckで「alive / timeout」の表示が実際のmotion受信状態と食い違う可能性がある。

必要な解決:

- heartbeat timeoutとmotion timeoutを別条件として定義する。
- Error codeを分けない場合でも、`UNITY_BRIDGE_TIMEOUT` のdetailSafeまたはstatus表示で `heartbeatTimeout` / `motionTimeout` を区別する。

---

### P2-05. `DUPLICATE_SOURCE` はあるが、現在のidentity定義では検出困難

`StatusWarningCode` に `DUPLICATE_SOURCE` があるが、送信元identityは `source + remoteAddress` で固定され、`remotePort` と `sessionId` はidentityに含めないとされている。

同一PCでUnity BridgeやMockを二重起動した場合、同じ `source + remoteAddress` として混ざる可能性がある。

根拠:

- `SPEC.md:291`
- `SPEC.md:539-552`
- `SPEC.md:613-628`

実装影響:

- `DUPLICATE_SOURCE` をいつ出すか実装できない、またはsessionId切替と誤判定する。
- mock二重起動やUnity Bridge再起動中にseq gap / rollback / session change warningが過剰に出る。

必要な解決:

- `DUPLICATE_SOURCE` の検出条件を明記する。
- remotePortをidentityには含めないまま、同一source + remoteAddressで異なるsessionIdが短時間に交互到着する場合などをduplicate候補にする、など条件を固定する。

---

## 追加未解決問題一覧（2026-06-06再検証追記）

以下は、さらに横断確認して見つけた未記載の追加懸念。運用・安全・配布周辺だけの課題は除外し、実装、型、状態遷移、score、diagnostics、動画/音響、テスト期待値に現実的な影響があるものに限定する。

### P1-22. `avatar.isHuman=false` のmotion sample扱いが未固定

`MotionQualityFlag` と `AppErrorCode` には `AVATAR_NOT_READY` があり、Error固定表では `avatar.isHuman=false` が条件に含まれている。

しかしmotion packet処理では、`isTracked=false` または `avatar.hasRightHand=false` の場合だけ `isAvailable=false` の `MotionSample` を作ると定義されており、`avatar.isHuman=false` のmotionをどう扱うかが明記されていない。

根拠:

- `SPEC.md:345`
- `SPEC.md:348`
- `SPEC.md:452`
- `SPEC.md:1242`

実装影響:

- `avatar.isHuman=false` をpacket invalidにする実装と、`isAvailable=false` sampleにする実装が分かれる。
- `AVATAR_NOT_READY` を `quality.flags` に付けるか、status/app:errorだけに出すかが揺れる。
- score / Calibration除外、InputCheck表示、validator testの期待値が固定できない。

必要な解決:

- `avatar.isHuman=false` のmotionは破棄せず `isAvailable=false` / `validForScore=false` / `validForCalibration=false` のsampleにする、またはinvalidにする、のどちらかを固定する。
- sample化する場合は `quality.flags` に `AVATAR_NOT_READY` を付け、保持する `handPosition` とbaseline reset条件も明記する。

---

### P1-23. `verticalNoiseThreshold` が参照されるがconfig契約にない

上下チャージでは `verticalNoiseThreshold` 以下の微小揺れを無視するとされ、マイルストーンでも設定化対象になっている。

しかし `ScoreConfig` 型と `score.config.json` 例には `verticalNoiseThreshold` がない。さらに前後チャージは上下と同じ差分積算なのに、`forwardNoiseThreshold` を設けるかどうかも未定義。

根拠:

- `SPEC.md:1040`
- `SPEC.md:718-724`
- `SPEC.md:1325-1358`
- `docs/requirements.md:875-879`
- `MILESTONES.md:252`
- `HUMAN_TEST_GUIDE_JA.md:607`

実装影響:

- 静止jitterで上下チャージが増えるかどうかが実装者任せになる。
- `score.config.json` に閾値を置く実装と、コード内固定値にする実装が分かれる。
- 前後チャージだけ微小揺れを積算し続ける実装になり、Gate D1の静止安定性と実プレイスコアが乖離する可能性がある。

必要な解決:

- `ScoreConfig` に `charge.verticalNoiseThresholdM` などの具体fieldを追加し、単位と初期値を固定する。
- 前後チャージにも同等の閾値を置くか、置かない理由を明記する。

---

### P1-24. `videoLevels.maxPower` の包含規則が未定義

本文の動画レベル表は `10000 <= Power < 50000` のように上限未満で定義されている。

一方、`score.config.json` 例の `videoLevels` は `minPower` / `maxPower` だけを持ち、`maxPower` が包含か排他かを型や説明で表していない。

根拠:

- `SPEC.md:1147-1152`
- `SPEC.md:723`
- `SPEC.md:1351-1357`
- `HUMAN_TEST_GUIDE_JA.md:733-740`

実装影響:

- `Power=10000`、`50000`、`150000` などの境界値で、隣接レベルのどちらを選ぶかが実装者任せになる。
- Human guideの境界値確認と `videoManager` unit testが設定駆動実装と食い違う可能性がある。
- config validatorでレベル範囲の重複・隙間を検出しにくい。

必要な解決:

- `videoLevels` は `minPower <= power < maxPower`、`maxPower=null` は無上限、など包含規則を明記する。
- validatorで隣接levelの `previous.maxPower === next.minPower` を許す/必須にするかを固定する。

---

### P1-25. R / Esc / replayの遷移先とreset scopeが曖昧

`R` は「InputCheckまたはTitleへ戻す」、Human guideのResult再プレイも「InputCheckまたはTitleへ戻れる」とされている。

また、reset時にscore、phase timer、keyboard pressed state、MotionSample baseline、filter、error/warning、video/audio再生状態、Calibration結果をどこまで破棄するかがまとまっていない。

根拠:

- `SPEC.md:828-831`
- `SPEC.md:846-847`
- `SPEC.md:746`
- `SPEC.md:760`
- `HUMAN_TEST_GUIDE_JA.md:121-123`
- `HUMAN_TEST_GUIDE_JA.md:301`
- `HUMAN_TEST_GUIDE_JA.md:305-306`
- `MILESTONES.md:122`

実装影響:

- stateMachine unit testで、同じ操作に対して `Title` 期待と `InputCheck` 期待が割れる。
- 再プレイ後に前回scoreやpressed stateが残る不具合を、仕様違反として判定しづらい。
- `app:reset-play`、`input:reset-filter`、`keyboard:control reset-pressed-state` の呼び分けが実装者任せになる。

必要な解決:

- `R`、`Esc`、Result replay、Error recoveryごとに遷移先を1つずつ固定する。
- reset scope表を追加し、score/timer/sample baseline/filter/keyboard state/video/audio/error/calibrationを「保持」「破棄」「再計算」に分類する。

---

### P1-26. `motionHz` / `LOW_SAMPLE_RATE` の集計windowと猶予が未定義

`LOW_SAMPLE_RATE` は active sourceの `motionHz < lowSampleRateHz` で発火し、Gate D1では平均30Hz以上が条件になっている。

しかし `motionHz` を何秒windowで計算するか、`receivedAtMs` とpacket `timestampMs` のどちらを使うか、invalid packetや `validForScore=false` sampleを分母に含めるか、mode切替直後に何ms猶予するかが定義されていない。`requiredSampleRateHz` と `lowSampleRateHz` の使い分けも弱い。

根拠:

- `SPEC.md:619`
- `SPEC.md:709-710`
- `SPEC.md:1207`
- `SPEC.md:1244`
- `SPEC.md:1294-1295`
- `SPEC.md:1407`
- `HUMAN_TEST_GUIDE_JA.md:682-688`

実装影響:

- 起動直後やmode切替直後に `motionHz=0` として即 `LOW_SAMPLE_RATE` を出す実装になり得る。
- 同じ30Hz入力でも、集計window次第でwarningの点滅やGate D1判定の差が出る。
- `requiredSampleRateHz=30` をCalibration/Gate専用にするか、通常InputCheckにも使うかが分かれる。

必要な解決:

- `motionHz` / `heartbeatHz` の集計window、clock、invalid packetの扱い、mode切替直後の猶予時間を固定する。
- `lowSampleRateHz` はwarning、`requiredSampleRateHz` はCalibration/Gate条件、など役割を明記する。

---

### P1-27. Unity Bridge timeout値が1秒と1500msで衝突している

`SPEC.md` はheartbeat timeout初期値を `1500ms` とし、`input.config.json` 例にも `heartbeatTimeoutMs: 1500` を置いている。

一方、`docs/requirements.md` のエラー条件では、Unity Bridge未受信を「1秒以上heartbeatもmotionも来ない」としている。

根拠:

- `SPEC.md:261`
- `SPEC.md:708`
- `SPEC.md:1240`
- `SPEC.md:1293`
- `docs/requirements.md:1082`
- `HUMAN_TEST_GUIDE_JA.md:658`

実装影響:

- timeout表示を1000msで出す実装と1500msで出す実装が分かれる。
- Human guideの「1秒以上待つ」手順で、1500ms実装ではまだtimeoutしない場合がある。
- heartbeat timerのunit testとInputCheck手動確認の期待値が割れる。

必要な解決:

- 1500msを正にするなら、`docs/requirements.md` とHuman guideを「1500ms以上」または「約2秒待つ」に合わせる。
- 1000msを正にするなら、`SPEC.md` のtimeout理由とconfig例を更新する。

---

### P1-28. Hakkei cooldownが300msと500msで衝突している

`SPEC.md` の発勁検出条件は `hakkeiCooldownMs` を使い、初期値とconfig例は `500ms` になっている。

一方、`docs/requirements.md` では「直近300ms以内に発勁検出済みでない」と固定値で書かれている。

根拠:

- `SPEC.md:1012`
- `SPEC.md:1024`
- `SPEC.md:1342`
- `docs/requirements.md:816`
- `docs/requirements.md:828`
- `MILESTONES.md:257`

実装影響:

- 連続突き、Keyboard Enter連打、二重検出防止テストの期待値が300ms/500msで割れる。
- `score.config.json` を正にする実装と、requirements本文の300msを正にする実装が分かれる。

必要な解決:

- `hakkeiCooldownMs=500` を正とし、`docs/requirements.md` の300ms表記を設定値参照へ更新する。
- 300msにする場合は `SPEC.md` とconfig例を合わせる。

---

### P2-06. 発勁判定の「加速度Magnitude」の扱いが未定義

発勁判定の要素表には「加速度Magnitude」が補助指標として含まれているが、検出条件、config、HakkeiScore式には `forwardAcceleration` しか出てこない。

根拠:

- `SPEC.md:1001`
- `SPEC.md:1007-1013`
- `SPEC.md:1057`
- `SPEC.md:1337-1345`
- `docs/requirements.md:805`
- `docs/requirements.md:811-818`

実装影響:

- 加速度Magnitudeを完全に無視する実装と、独自の追加閾値として使う実装が分かれる。
- 横振りや斜め振りの誤検出テストで、forward成分だけを見るのか、3D勢いも見るのかが揺れる。
- `hakkeiDetector` と `scoreCalculator` のfixture設計が不安定になる。

必要な解決:

- 加速度Magnitudeはdiagnostics表示だけに使う、または検出/scoreへ入れる、のどちらかを固定する。
- 検出に入れる場合はconfig key、単位、閾値、forward条件との優先順位を明記する。

---

### P2-07. Ready / HakkeiReady / ImpactDelayのtimer値がSPEC/configに固定されていない

`docs/requirements.md` とHuman guideにはReady 2〜3秒、HakkeiReady最大5秒、ImpactDelay 0.2〜0.5秒の目安がある。

しかし `SPEC.md` の状態遷移は「カウントダウン終了」「タイムアウト」「ImpactDelay」だけで、具体timer値や設定場所がない。`score.config.json` には `hakkeiWindowMs` はあるが、HakkeiReadyの待機timeoutとは別概念である。

根拠:

- `SPEC.md:821`
- `SPEC.md:825`
- `SPEC.md:806`
- `docs/requirements.md:661-665`
- `HUMAN_TEST_GUIDE_JA.md:212-213`
- `HUMAN_TEST_GUIDE_JA.md:261`
- `MILESTONES.md:127`
- `MILESTONES.md:275`

実装影響:

- Ready countdown、HakkeiReady timeout、ImpactDelayのe2e test期待値が実装者ごとに変わる。
- HakkeiReady timeoutの意味を修正しても、timeout秒数が別途固定されないまま残る。
- ImpactDelay中にsampleを受け続けるか、動画開始まで入力を無視するかの実装判断にも影響する。

必要な解決:

- `AppConfig` または `ScoreConfig` に `readyCountdownMs`、`hakkeiReadyTimeoutMs`、`impactDelayMs` を追加する。
- timerのclock基準はP1-11と同じ方針に合わせ、状態遷移テストの固定値にする。

---

### P2-08. `damageYen` の丸めと表示形式が未定義

損害額は `damageYen = Power * yenCoefficient` とされ、Resultでは「円表記」と「最も大きく表示」が求められている。

しかし `damageYen` を整数に丸めるか、小数を許すか、四捨五入/切り捨て/切り上げのどれにするか、桁区切りを入れるかが定義されていない。

根拠:

- `SPEC.md:1099-1103`
- `SPEC.md:1124`
- `SPEC.md:1219-1228`
- `docs/requirements.md:940-944`
- `docs/requirements.md:1061-1072`
- `MILESTONES.md:138`
- `HUMAN_TEST_GUIDE_JA.md:290-305`

実装影響:

- `yenCoefficient` が整数でも、Powerが小数になった場合に小数円表示が出る可能性がある。
- Result UIとunit testで `12345円`、`12,345円`、`12,345.6円` など期待値が割れる。
- `SCORE_INVALID` ではないが見た目上の不具合としてレビューで戻りやすい。

必要な解決:

- `damageYen` は計算値、表示値は `damageYenDisplay` として整数丸め・桁区切り・単位を固定する。
- 例: `Math.round(Power * yenCoefficient)` を `ja-JP` localeで桁区切りし、末尾に `円` を付ける。

---

### P2-09. 音響assetの設定、再生タイミング、欠落時のclear条件が弱い

音響仕様では `charge.mp3`、`hakkei.mp3`、`impact.mp3`、`result.mp3` の用途が示され、`AUDIO_MISSING` はwarningでゲーム進行を止めないとされている。

しかし音声assetのpathをどのconfigに持つか、`charge.mp3` をloopするか、状態遷移時に停止するか、欠落復旧時に `AUDIO_MISSING` をいつclearするかが未定義。

根拠:

- `SPEC.md:160`
- `SPEC.md:177-182`
- `SPEC.md:1168-1177`
- `SPEC.md:1257`
- `docs/requirements.md:1019-1028`
- `MILESTONES.md:293`

実装影響:

- 音声ファイル名をコード固定にする実装と、config化する実装が分かれる。
- `charge.mp3` が次状態へ残り続ける、Result後も音が鳴る、`AUDIO_MISSING` warningが消えないなどの状態不整合が起きやすい。
- audioManagerの手動確認と自動テストで、missing audioを進行継続warningとして扱う期待値が固定できない。

必要な解決:

- `audio` configを追加し、各stateでの再生開始、停止、loop、missing時のwarning/clear条件を表にする。
- 音声はゲーム進行を止めないが、diagnosticに欠落asset名を出す、など表示範囲を固定する。

---

## 追加未解決問題一覧（2026-06-06三次検証追記）

以下は、さらに多角的に確認して見つけた未記載の追加懸念。既存項目へ吸収できるもの、運用・安全・配布周辺だけのものは除外した。

### P1-29. `app.config.json` の設定例が存在しない

`AppConfig` と `AppConfigBundle` は型として定義され、M4でも `config/app.config.json` を作ることになっている。

しかし `SPEC.md` の設定ファイル例は `input.config.json` と `score.config.json` だけで、`app.config.json` の例がない。`defaultInputMode`、`locale`、`appName` の初期値も固定されていない。

根拠:

- `SPEC.md:695-699`
- `SPEC.md:726-735`
- `SPEC.md:755`
- `SPEC.md:1286`
- `SPEC.md:1321`
- `MILESTONES.md:148`
- `MILESTONES.md:172`

実装影響:

- `config:get` のfixture、config validator、起動時の初期入力モードが実装者任せになる。
- `defaultInputMode="none"` でTitle待機にする実装と、Keyboardを既定にする実装が分かれる。
- `CONFIG_INVALID` のテストで、app設定欠損をfatal扱いにするかdefault補完するかが割れる。

必要な解決:

- `SPEC.md` に `app.config.json` 例を追加する。
- `defaultInputMode` の初期値、欠損時の扱い、`locale` の許容値を固定する。
- `AppConfig` も `InputConfig` / `ScoreConfig` と同じschema validation対象にする。

---

### P1-30. `TIMESTAMP_GAP` の発火条件とsample扱いが未定義

`MotionQualityFlag` と `StatusWarningCode` に `TIMESTAMP_GAP` がある。

しかし仕様上定義されているtimestamp異常はrollbackまたは同値だけで、どれくらいの前進差をgapと呼ぶか、`TIMESTAMP_GAP` が付いたsampleを `validForScore` にするか、`droppedFrameCount` とどう関係させるかがない。

根拠:

- `SPEC.md:287`
- `SPEC.md:342`
- `SPEC.md:450`
- `SPEC.md:479`
- `SPEC.md:542`
- `SPEC.md:1251`
- `SPEC.md:1273`
- `MILESTONES.md:196`

実装影響:

- seqが連番でもtimestampだけ大きく飛ぶpacketを、正常sample、dt異常sample、timestamp gap warningのどれにするかが分かれる。
- `droppedFrameCount` をseq gapだけで増やす実装と、timestamp gapでも増やす実装が分かれる。
- HakkeiReady中のwindow計算、charge積算、validSampleRatioの期待値が不安定になる。

必要な解決:

- `TIMESTAMP_GAP` の閾値を `maxDtMs` と同一にするか、別configにするか固定する。
- timestamp gap時のsample生成、`validForScore`、`validForCalibration`、`droppedFrameCount` 加算条件を表にする。
- seq gapとtimestamp gapが同時に起きた場合の優先順位も固定する。

---

### P1-31. 非active source packetの扱いと `SOURCE_MISMATCH` が衝突し得る

`StatusWarningCode` には `NON_ACTIVE_SOURCE_PACKET` がある。

一方で、非active sourceのheartbeatは `motion:heartbeat` へ流さずstatusだけ更新するとされ、Error固定表ではactive sourceとpacket sourceが混ざる場合を `SOURCE_MISMATCH` としている。さらにGate D2ではUnity由来Errorやwarningを `app:error-clear` で消すとされている。

根拠:

- `SPEC.md:389`
- `SPEC.md:550`
- `SPEC.md:580`
- `SPEC.md:1240`
- `SPEC.md:1244`
- `SPEC.md:1252`
- `SPEC.md:1280`
- `SPEC.md:1425`
- `MILESTONES.md:370`

実装影響:

- Keyboard active中にUnity Bridgeが送信し続ける正常packetを、無視、status更新、`NON_ACTIVE_SOURCE_PACKET` warning、`SOURCE_MISMATCH` warningのどれにするかが分かれる。
- Unity入力からKeyboard fallbackへ切り替えた後も、Unity由来warningが出続けてD2条件と矛盾する可能性がある。
- active sourceだけを `app:error` に出すか、非active sourceも出すかでError画面とdiagnostic表示が揺れる。

必要な解決:

- active source以外のpacketを受けた時の処理表を作る。
- 例: 非active packetはsource statusだけ更新し、activeWarnings / app:errorには出さない。source切替直後の短時間だけ `NON_ACTIVE_SOURCE_PACKET` をdiagnosticに出す。
- `SOURCE_MISMATCH` は同一active source内のidentity混線など、より狭い条件に限定する。

---

### P1-32. status / diagnostics / error eventのclock基準が未固定

`MotionSample.receivedAtMs` は `performance.now()` 系と定義されている。

しかし `MotionHeartbeatPayload.ageMs`、`SourceStatusSnapshot.lastMotionAtMs`、`lastHeartbeatAtMs`、`MotionStatusPayload.generatedAtMs`、`AppErrorPayload.occurredAtMs`、`MotionDiagnosticsPayload.generatedAtMs` のclock基準が明示されていない。`timestampMs` はsession相対時刻なので、これらと混ぜると「何ms前」表示が破綻する。

根拠:

- `SPEC.md:283-284`
- `SPEC.md:487-488`
- `SPEC.md:604`
- `SPEC.md:610`
- `SPEC.md:617-618`
- `SPEC.md:633`
- `SPEC.md:644`
- `SPEC.md:655`
- `SPEC.md:662`
- `SPEC.md:676`
- `SPEC.md:1205-1206`

実装影響:

- `ageMs` をpacket `timestampMs` から計算する実装と、Main受信時刻から計算する実装が分かれる。
- Unity session再起動後、session相対timestampが0へ戻った時にInputCheckの最終受信時刻表示が負値や巨大値になる可能性がある。
- timeout、error clear、diagnostics更新のテストでclock mockが統一できない。

必要な解決:

- IPC payload内の `*AtMs` / `generatedAtMs` / `occurredAtMs` はすべてElectron Mainのmonotonic clockと明記する。
- packet `timestampMs` はdt計算とrollback検証に限定し、UIの「何ms前」は `receivedAtMs` 系だけで計算すると固定する。
- Keyboard sampleの `timestampMs` もsession相対にするか、Main起動相対のままにするかを明記する。

---

### P1-33. Calibration結果のデータ型と保持scopeが未定義

Calibrationで保存する値として `neutralHandPosition`、`neutralBodyPosition`、`forwardVector`、`upVector`、`calibrationTimestampMs`、`calibrationQuality` が列挙されている。

しかし、これらをまとめたTypeScript型、Renderer内の保持scope、session/mode/reset時に破棄する条件、`calibration:set-state` でMainへ渡す範囲が定義されていない。

根拠:

- `SPEC.md:748-751`
- `SPEC.md:758`
- `SPEC.md:774`
- `SPEC.md:876-881`
- `HUMAN_TEST_GUIDE_JA.md:196`
- `HUMAN_TEST_GUIDE_JA.md:577-580`
- `MILESTONES.md:210-214`

実装影響:

- `calibration: 実施済み` 表示の根拠が、state文字列だけか、品質条件を満たしたCalibrationResultかで分かれる。
- 入力モード変更、session変更、`R`、Result再プレイでCalibrationを保持するか破棄するかが実装者任せになる。
- scoreCalculator / hakkeiDetectorへ `upVector` と `forwardVector` を渡す契約が曖昧になる。

必要な解決:

- `CalibrationResult` 型を定義し、保存field、source、sessionId、quality、createdAtMsを固定する。
- mode change、session change、manual reset、replayごとの保持/破棄規則をreset scope表に入れる。
- `calibration:set-state` は状態通知だけにするのか、MainへCalibration結果も渡すのかを明記する。

---

### P1-34. `ScoreBreakdown` の整合性検証条件が弱い

`ScoreBreakdown` には `verticalScore`、`forwardScore`、`hakkeiScore`、`power`、`damageYen`、`rank`、`videoLevel` が同時に入る。

しかし通常プレイで、`power` が3スコアと係数から再計算した値と一致するか、`damageYen` が `power * yenCoefficient` と一致するか、`videoLevel` がPower境界と一致するかを検証する条件がない。`SCORE_INVALID` の固定条件もNaN/Infinity/負のPowerに限られている。

根拠:

- `SPEC.md:1096`
- `SPEC.md:1102`
- `SPEC.md:1119-1127`
- `SPEC.md:1130`
- `SPEC.md:1147-1152`
- `SPEC.md:1259`
- `HUMAN_TEST_GUIDE_JA.md:299-305`
- `HUMAN_TEST_GUIDE_JA.md:745`

実装影響:

- Result presenterが受け取った `ScoreBreakdown.videoLevel` を信用する実装と、videoManagerがPowerから再選択する実装が分かれる。
- Debug Fixtureやテストで、Powerと内訳が矛盾したデータを通せてしまう。
- `rank`、`videoLevel`、`damageYen` の不整合が `SCORE_INVALID` にならず、Resultだけが誤表示になる可能性がある。

必要な解決:

- 通常プレイの `ScoreBreakdown` は単一関数で生成し、派生fieldを個別上書きしないと明記する。
- `ScoreBreakdown` invariantを追加する。例: scoreは0〜100、powerは計算式一致、videoLevelはselector一致、damageYenは丸め規則一致。
- Debug Fixtureでは不整合fixtureを許す場合と拒否する場合を分ける。

---

### P1-35. Keyboard A/D疑似入力の軸が固定されていない

`SPEC.md` ではA/Dをプレイヤーから見た手前/前方向の疑似入力とし、Enterも前方向の疑似MotionSample列を生成するとしている。

一方、`MILESTONES.md` ではA/Dの成果物が「疑似zまたはforward軸」となっている。Keyboard modeがCalibrationをskipまたは簡略化する場合、z軸を直接動かす実装と `forwardVector` を使う実装でForwardChargeとHakkei判定の結果が変わる。

根拠:

- `SPEC.md:503-517`
- `SPEC.md:878-879`
- `SPEC.md:1044-1047`
- `MILESTONES.md:120`
- `HUMAN_TEST_GUIDE_JA.md:238-246`

実装影響:

- Keyboard Gate A/D2で、A/Dを押しても前後チャージが増えない実装になり得る。
- Unity/MockではCalibration後forward軸、Keyboardでは固定z軸、という別score経路が生まれる可能性がある。
- Enter疑似突きがHakkei条件のforward成分を満たすかどうかが実装者ごとに変わる。

必要な解決:

- Keyboardでは疑似Calibrationにより `forwardVector` を固定し、A/D/Enterはそのforward軸に沿ってMotionSampleを生成する、と明記する。
- もしくはKeyboard専用の標準座標系を定義し、score側も同じ軸を使うことを固定する。
- `MILESTONES.md` の「疑似zまたはforward軸」を1つへ修正する。

---

### P2-10. `MotionDiagnosticsPayload.windowMs` が複数window指標を表しきれない

`MotionDiagnosticsPayload` には単一の `windowMs` がある。

しかし同じpayloadには2秒jitter指標と10秒静止発勁誤検出数が混在している。さらにconfig例にも `measurementWindowMs=2000` と `staticFalseHakkeiWindowMs=10000` が別々にある。

根拠:

- `SPEC.md:668-676`
- `SPEC.md:981-990`
- `SPEC.md:1310-1315`
- `SPEC.md:1410-1413`
- `HUMAN_TEST_GUIDE_JA.md:499-515`
- `docs/verification_checklist.md:51-59`

実装影響:

- `windowMs=2000` と入れると `staticFalseHakkeiCount10s` のwindowと矛盾する。
- `windowMs=10000` と入れるとjitter指標名の `2s` と矛盾する。
- diagnostics UIやGate D1ログで、どの指標がどの時間窓なのか読み違えやすい。

必要な解決:

- payloadから単一 `windowMs` を外し、`jitterWindowMs`、`staticFalseHakkeiWindowMs`、`validSampleRatioWindowMs` などへ分ける。
- あるいは各metricを `{ value, windowMs }` 形式にする。

---

### P2-11. `frameRate` の「NaN相当heartbeat JSON」手順がJSON仕様と噛み合わない

Human guideは `frameRate` がNaN相当のheartbeat JSONを送る手順を求めている。

しかし標準JSONでは `NaN` は数値として表現できない。`{"frameRate": NaN}` はJSON parse失敗で `INVALID_JSON` になり、`{"frameRate": "NaN"}` はparse成功後の型不一致で `INVALID_HEARTBEAT_PACKET` になる。

根拠:

- `HUMAN_TEST_GUIDE_JA.md:407-416`
- `SPEC.md:386`
- `SPEC.md:1245`
- `SPEC.md:1249`
- `SPEC.md:1268`

実装影響:

- mock script実装者が未quoted `NaN` を送るか、文字列 `"NaN"` を送るかで期待codeが変わる。
- validator testで `INVALID_JSON` と `INVALID_HEARTBEAT_PACKET` のどちらをassertすべきか割れる。
- `frameRate` 不正の復帰確認が、parse層のテストなのかheartbeat schema層のテストなのか曖昧になる。

必要な解決:

- Human guideとmock script名を分ける。例: `mock:unity:invalid-json-nan-token` は `INVALID_JSON`、`mock:unity:invalid-heartbeat-framerate-string` は `INVALID_HEARTBEAT_PACKET`。
- `frameRate` schema不正として確認する場合は、`null`、文字列、0、負数などJSONとして妥当な値を使う。

---

## 追加未解決問題一覧（2026-06-06四次検証追記）

以下は、既存の三次検証までに含まれていない追加懸念。運用・安全・配布周辺だけのものは除外し、現実の実装、型、状態、diagnostics、テスト実行に直接影響するものに限定する。

### P0-13. 現リポジトリがMarkdownのみで、M0の実装検証基盤が存在しない

現リポジトリ実体を確認すると、`package.json`、`tsconfig.json`、`src/`、`config/`、`assets/`、`unity-bridge/` が存在しない。

READMEとMILESTONESは、これらが未作成ならM0未完了と明記している。一方、`UNRESOLVED_ISSUES_CURRENT.md` には、仕様矛盾は多数あるが、現リポジトリで自動検証や最小起動をまだ実行できないという状態が未記載だった。

根拠:

- 現リポジトリ確認: `package.json` / `tsconfig.json` / `src/` / `config/` / `assets/` / `unity-bridge/` がすべて未存在
- `README.md:34-36`
- `MILESTONES.md:33-37`
- `MILESTONES.md:85-88`

実装影響:

- `npm run lint`、`npm run typecheck`、`npm test`、`npm run dev` を開始できない。
- 型契約、validator、stateMachine、score、videoManagerの問題が、仕様レビュー止まりで実コードに対して確認できない。
- 次のCodex実装依頼で、まずプロジェクト初期化から始める必要があり、既存コード差分としてのレビューができない。
- `config/*.json` のschema不一致や `AppConfigBundle` のfixtureを、実ファイルで検証できない。

必要な解決:

- M0-11〜M0-14を先に完了し、最小Electron起動、`package.json`、`tsconfig.json`、lint/test scriptを置く。
- `config/app.config.json`、`config/input.config.json`、`config/score.config.json` はM4予定でも、schema検証fixture用の最小サンプルを早めに置くか、M4まで `BLOCKED_M0_CONFIG_FILES` と明記する。
- この問題は仕様矛盾ではなく現リポジトリ状態の blocker として扱い、以後の自動検証結果欄に「未実行理由」として残す。

---

### P1-36. `avatarRoot.transform.forward` 前提に必要なデータがUDP契約にない

Calibrationの簡略化では `forwardVector = avatarRoot.transform.forward` とする、と定義されている。

しかしUnity BridgeからElectronへ送る標準motion JSONはRightHand座標、tracking状態、avatar状態だけで、Avatar root、Hips、root forward、body position、body rotationを送らない。`CalibrationStatePayload` も状態通知だけで、Unity側のforward vectorをMain/Rendererへ渡す契約になっていない。

根拠:

- `SPEC.md:319-331`
- `SPEC.md:371-376`
- `SPEC.md:748-758`
- `SPEC.md:877-886`
- `docs/requirements.md:682-683`
- `docs/requirements.md:709`

実装影響:

- Electron側だけでは `avatarRoot.transform.forward` を取得できないため、簡略化仕様のままではforwardVectorを実装できない。
- 実装者が固定z軸、Calibration時の右手移動推定、Unity Bridge payload拡張のどれかを推測で選ぶことになる。
- 前後チャージ、横振り抑制、Hakkei forward条件、Gate C/D1の期待値が大きく変わる。
- P1-18の「採用優先順位」以前に、採用候補の1つがデータ契約上到達不能になっている。

必要な解決:

- Unity Bridgeが `avatarRootForward`、`avatarRootPosition`、必要なら `hipsPosition` を送るpacket拡張を正式化する。
- 送らない方針なら、`avatarRoot.transform.forward` をElectron仕様から外し、Calibration時の右手移動推定またはconfig座標系だけでforwardVectorを決めると明記する。
- `CalibrationResult.forwardVectorSource` に `unity-avatar-forward` / `gesture-inferred` / `config-default` などの採用元を持たせる。

---

### P1-37. Keyboard sourceのstatus snapshot初期値が未定義

`MotionSource` には `keyboard` が含まれ、`MotionStatusPayload.sourceStatuses` は `Record<MotionSource, SourceStatusSnapshot>` になっている。

しかし `SourceStatusSnapshot` には `heartbeatHz`、`avatarReady`、`rightHandReady`、`lastHeartbeatAtMs` などUnity/Mock向けのfieldが必須であり、Keyboard sourceでこれらをどう表すかが定義されていない。InputCheckはKeyboardモードでも表示されるが、heartbeat状態やrightHandReadyの扱いが固定されていない。

根拠:

- `SPEC.md:437`
- `SPEC.md:613-627`
- `SPEC.md:631-636`
- `SPEC.md:818`
- `SPEC.md:1203-1209`
- `HUMAN_TEST_GUIDE_JA.md:175-182`
- `MILESTONES.md:179-187`

実装影響:

- Keyboard active中に `heartbeatHz=0` / `rightHandReady=null` を正常扱いする実装と、timeout/NG扱いする実装が分かれる。
- Gate AのKeyboard完走で、Unity Bridge未受信警告が残り続ける可能性がある。
- InputCheck UIでKeyboard modeの正常状態を「OK」と出す条件が固定できない。
- status unit testでKeyboard source snapshotの期待値が書けない。

必要な解決:

- Keyboard用 `SourceStatusSnapshot` の必須初期値を定義する。例: `heartbeatHz=0`、`avatarReady=null`、`rightHandReady=null`、`isReceiving=true` はkeyboard generator稼働中、など。
- InputCheck表示をsource種別ごとに分け、Keyboardではheartbeat/rightHandReadyを `対象外` と表示する。
- `UNITY_BRIDGE_TIMEOUT` や `RIGHT_HAND_UNAVAILABLE` はKeyboard active中にactiveErrorsへ出さないと明記する。

---

### P1-38. `config:get` が `CONFIG_INVALID` を型付きで返せない

`CONFIG_INVALID` はfatal / recoverable=falseの固定Errorとして定義されている。

一方、Renderer -> Mainの `config:get` responseは `AppConfigBundle` そのものであり、`IpcResult<AppConfigBundle>` ではない。preload APIの `getConfig()` も `Promise<AppConfigBundle>` だけを返す。設定読込失敗やschema違反時に、Promise reject、`app:error` event、fatal画面、同期throwのどれで扱うかが固定されていない。

根拠:

- `SPEC.md:586`
- `SPEC.md:591-593`
- `SPEC.md:726-735`
- `SPEC.md:755`
- `SPEC.md:771`
- `SPEC.md:1258`
- `MILESTONES.md:172`

実装影響:

- 起動直後にconfigが壊れている場合、Rendererが `getConfig()` 失敗をどう表示するか実装者任せになる。
- `CONFIG_INVALID` の自動テストで、IPC responseをassertするのか、`app:error` eventを待つのか、Promise rejectを期待するのかが割れる。
- fatal errorなのにpreload API型上は成功値しか返せず、`IPC_CONTRACT_VIOLATION` と混同される可能性がある。

必要な解決:

- `config:get` responseを `IpcResult<AppConfigBundle>` にする。
- もしくは起動時config loadをMainで完了させ、失敗時はRendererへ `app:error` を必ず送って `getConfig()` を呼べない状態にする、など単一方針を明記する。
- `CONFIG_INVALID` fixtureでは、壊れたJSON、schema違反、範囲違反それぞれの期待経路を固定する。

---

### P1-39. 10秒静止発勁誤検出の測定経路が通常状態遷移と噛み合わない

Gate D1では10秒静止で発勁誤検出0回を要求し、`MotionDiagnosticsPayload` にも `staticFalseHakkeiCount10s` がある。

しかし通常のHakkeiReadyはtimeoutでImpactDelayへ進む。Human guideでは「HakkeiReady相当の状態で10秒静止」と書かれているが、通常stateMachine上のHakkeiReadyを使うのか、diagnostic専用モードでHakkei detectorだけを動かすのかが定義されていない。

根拠:

- `SPEC.md:675`
- `SPEC.md:825`
- `SPEC.md:986`
- `SPEC.md:1007`
- `SPEC.md:1315`
- `SPEC.md:1413`
- `HUMAN_TEST_GUIDE_JA.md:261`
- `HUMAN_TEST_GUIDE_JA.md:504-515`
- `MILESTONES.md:202`
- `MILESTONES.md:242`

実装影響:

- 通常プレイではHakkeiReady timeoutにより10秒静止を完了できない可能性がある。
- `staticFalseHakkeiCount10s` をInputCheck/diagnosticsで計測する実装と、HakkeiReady中だけ計測する実装が分かれる。
- detectorを通常状態外で動かす場合、cooldown、forwardVector、Calibration有無、validForScoreの扱いが通常HakkeiReadyと一致する保証がない。
- Gate D1の「静止誤検出0回」が、人間確認とunit testで別の経路を見てしまう。

必要な解決:

- 静止誤検出測定専用のdiagnostic modeまたはtest harnessを定義し、HakkeiReady timeoutを無効化して10秒間detectorだけを通常条件で評価する。
- もしくはGate D1の静止確認をHakkeiReady timeout未満のwindowに合わせ、`staticFalseHakkeiWindowMs` も同じ値へ変更する。
- `staticFalseHakkeiCount10s` の計算条件として、Calibration必須/不要、activeMode、validForScore、cooldown reset、評価するforwardVectorを明記する。

---

## 追加未解決問題一覧（2026-06-06五次検証追記）

以下は、四次検証までの既存項目を重複確認したうえで追加する懸念。運用・安全・配布周辺だけのものは除外し、状態遷移、IPC/status更新、Keyboard fallbackの実装とテスト期待値に直接影響するものに限定する。

### P1-40. InputCheckの「Unity Bridge入力OK」判定が実装可能な条件表になっていない

状態遷移では `InputCheck --> Calibration: Unity Bridge入力OK` と定義され、Human guideでも `InputCheckがOKの状態` からCalibrationやjitter確認へ進む手順になっている。

しかし `Unity Bridge入力OK` が、最終motion受信時刻、heartbeat alive、`avatarReady`、`rightHandReady`、`motionHz`、`validSampleRatio`、activeErrors / activeWarnings のどれを満たした状態なのかが表になっていない。`InputCheck` 表示項目は列挙されているが、OK/NGや次へ進める条件までは固定されていない。

根拠:

- `SPEC.md:817`
- `SPEC.md:1203-1214`
- `SPEC.md:1240-1244`
- `MILESTONES.md:180-187`
- `MILESTONES.md:336-337`
- `HUMAN_TEST_GUIDE_JA.md:496`
- `HUMAN_TEST_GUIDE_JA.md:569`

実装影響:

- heartbeatだけ届いてmotionが止まっている状態をOKにする実装と、NGにする実装が分かれる。
- `rightHandReady=false`、`avatarReady=false`、`LOW_SAMPLE_RATE` warning中でもCalibrationへ進めるかどうかが実装者任せになる。
- Human guideの「InputCheckがOKの状態」が、画面表示だけのOKなのか、stateMachine遷移可能条件なのか不明になる。
- InputCheck / Calibration / Gate B-CのE2E testで、開始ボタンのenabled条件や遷移期待値が固定できない。

必要な解決:

- InputModeごとのInputCheck OK条件表を追加する。例: Unity/Mockは active sourceの最新valid motion、heartbeat alive、`avatarReady=true`、`rightHandReady=true`、最低motionHz、active blocking errorなしを満たす、など。
- `LOW_SAMPLE_RATE` や `COORDINATE_RANGE_WARN` を「警告表示のみで開始可」にするか「Calibration不可」にするかを固定する。
- OK表示、開始ボタンenabled、`InputCheck -> Calibration/Ready` 遷移条件、Gate B/C判定条件を同じ表へ揃える。

---

### P1-41. timeoutを表示するための `motion:status` 定期更新契約がない

`MotionHeartbeatPayload` には `isAlive` と `ageMs` があり、InputCheckには heartbeat状態 `alive / timeout` を表示するとある。Error固定表でも `UNITY_BRIDGE_TIMEOUT` が定義されている。

しかし `motion:heartbeat` と `motion:status` はpacket受信後の処理順で送られるように読める。Unity Bridge停止時は新しいpacketが来ないため、Mainが別途timerでstatusを再評価してRendererへ送らなければ、画面は最後のalive表示のまま止まる可能性がある。status再評価の周期、owner、`app:error` / `app:error-clear` の発火タイミングも固定されていない。

根拠:

- `SPEC.md:389`
- `SPEC.md:599-610`
- `SPEC.md:631-637`
- `SPEC.md:1205-1208`
- `SPEC.md:1240`
- `MILESTONES.md:183`
- `HUMAN_TEST_GUIDE_JA.md:656-663`

実装影響:

- heartbeat停止確認で、実際にはtimeout時刻を過ぎてもRendererに何も届かず、`UNITY_BRIDGE_TIMEOUT` が表示されない実装になり得る。
- `motion:heartbeat.isAlive=false` を送る実装と、heartbeat eventは受信時のみ送ってtimeoutはstatus eventだけで表す実装が分かれる。
- timeout復帰時の `app:error-clear` が、次packet受信時だけ出るのか、定期status評価で出るのかが割れる。
- heartbeat stall / Unity停止のE2E testで、何ms後にどのIPC eventを待つべきか固定できない。

必要な解決:

- Main Processにstatus監視timerを置くかどうか、置く場合の周期を固定する。例: `statusUpdateIntervalMs=250`。
- `motion:heartbeat` はheartbeat受信時の事実だけにし、alive/timeout表示は `motion:status` の定期snapshotで判断する、など役割を分ける。
- timeout発火、復帰、`app:error`、`app:error-clear`、`activeErrors` 更新の順序と期待IPCをテスト可能な時系列で定義する。

---

### P1-42. KeyboardControlPayloadのキー識別子とpressed state失効条件が未固定

`KeyboardControlPayload` は field名を `key` としつつ、値には `"KeyA"` / `"KeyD"` / `"Space"` / `"Enter"` を使っている。これはDOM `KeyboardEvent.code` に近い値であり、DOM `KeyboardEvent.key` で実装するとA/Dは `"a"` / `"d"`、Spaceは空白文字になり得る。

また、OSキーリピートを無視してkeydown/keyupのpressed stateを使う方針はあるが、window blur、visibility change、mode change、Error遷移などでkeyupを取り逃した場合にMain側pressed stateをいつ解除するかが固定されていない。`reset-pressed-state` commandはあるが、送る条件が仕様化されていない。

根拠:

- `SPEC.md:526`
- `SPEC.md:744-746`
- `SPEC.md:757`
- `SPEC.md:773`
- `MILESTONES.md:118`
- `HUMAN_TEST_GUIDE_JA.md:220-248`

実装影響:

- Rendererが `event.key` を送ると、Mainの型定義と一致せず、Space/A/D/Enterが反応しない可能性がある。
- 逆にMain側が `KeyboardEvent.key` 前提で実装すると、`KeyA` / `KeyD` fixtureが失敗する。
- keyupを取り逃した後にSpaceやDが押され続けた扱いになり、上下/前後チャージやEnter由来のHakkei判定が暴走し得る。
- Keyboard Gate A/D2、10回連続確認、keyboardInput unit testで、イベントpayloadと失効条件の期待値が割れる。

必要な解決:

- payload fieldを `code` に改名するか、`key` fieldでもDOM `KeyboardEvent.code` を送ると明記する。
- Rendererは `event.repeat` を送るがMainはrepeat=trueを無視する、などkey repeat処理の責務を固定する。
- blur / visibilitychange / mode change / Title復帰 / Error遷移 / reset時に `reset-pressed-state` を送る条件を表にする。
- keyboardInput unit testに `event.key` と `event.code` の取り違え、keyup欠落後のresetを追加する。

---

## 追加未解決問題一覧（2026-06-06六次検証追記）

以下は、五次検証までの既存項目と重複しないように再確認したうえで追加する懸念。運用・安全・配布周辺だけのものは除外し、preload / session整合 / score入力field / diagnostics / Error clear契約など、実装とテスト期待値に直接影響するものに限定する。

### P1-43. preload実装タスクとchecklistが中核Inbound APIを確認していない

`SPEC.md` の `HakkeiPreloadApi` には `onMotionSample`、`onMotionStatus`、`onMotionDiagnostics`、`onAppError`、`onMotionHeartbeat`、`onMotionSessionChanged`、`onAppErrorClear` が定義されている。

一方、`MILESTONES.md` のM5-16と `docs/verification_checklist.md` のpreload確認は、`onMotionHeartbeat` / `onMotionSessionChanged` / `onAppErrorClear` / `getConfig` だけを明示している。`motion:sample`、`motion:status`、`motion:diagnostics`、`app:error` は別タスクでIPC作成があるが、preload公開と人間確認の完了条件から漏れている。

根拠:

- `SPEC.md:679-686`
- `SPEC.md:770-785`
- `MILESTONES.md:165-173`
- `docs/verification_checklist.md:31-33`
- `docs/archive/reviews/VALIDATION_REPORT.md:47`

実装影響:

- Mainが `motion:sample` を送っても、Rendererが購読できず通常入力経路が成立しない実装でM5-16を完了扱いにできてしまう。
- InputCheckが必要とする `motion:status`、Gate C/D1が必要とする `motion:diagnostics`、Error表示が必要とする `app:error` のpreload穴をchecklistで検出できない。
- typed IPC unit testは通っても、Renderer統合で「イベントが届かない」不具合が残る。

必要な解決:

- M5-16とchecklistに `onMotionSample`、`onMotionStatus`、`onMotionDiagnostics`、`onAppError` を追加する。
- preload API実装テストでは、`RendererInboundEvents` の全keyに対応する購読関数が存在し、`Unsubscribe` が返ることをassertする。
- Gate B2/Cの確認項目に、sample/status/diagnostics/errorがpreload越しにRendererへ届くことを入れる。

---

### P1-44. motion / heartbeat のsession不一致時の扱いが未定義

packetの `timestampMs` 判定は `source + remoteAddress + sessionId + type` ごとに行い、送信元identityは `source + remoteAddress` とされている。`SourceStatusSnapshot` は単一の `currentSessionId` しか持たない。

しかし、同じ `source + remoteAddress` から、motionとheartbeatで異なる `sessionId` が同時期に届いた場合の扱いが定義されていない。Unity Bridgeの実装ミス、Mock scriptのバグ、再起動途中のpacket混在で起き得るが、これを `session-changed` として受け続けるのか、`SOURCE_MISMATCH` 相当として警告するのか、片方を破棄するのかが決まっていない。

根拠:

- `SPEC.md:287-291`
- `SPEC.md:371-376`
- `SPEC.md:613-627`
- `SPEC.md:639-645`

実装影響:

- heartbeat session Aの `rightHandReady=true` でInputCheckをOKにしつつ、motion sampleはsession Bから来る、という混線状態を正常扱いできてしまう。
- `currentSessionId` がmotion/heartbeatの到着順で揺れ、RendererのCalibration破棄、filter reset、session表示が点滅する可能性がある。
- `motion:session-changed` のunit testで、type別session変更を許す実装とsource全体で一致必須にする実装に分かれる。

必要な解決:

- Source単位でmotion sessionとheartbeat sessionを一致必須にするか、`motionSessionId` / `heartbeatSessionId` を別fieldとしてstatusに持つかを決める。
- 不一致を許さない場合は `SESSION_MISMATCH` などのwarning/error codeを追加するか、既存 `SOURCE_MISMATCH` の固定条件に含める。
- 不一致発生時の `motion:sample` 生成、heartbeat readiness反映、Calibration破棄、filter reset、`motion:session-changed` 発火条件を時系列で固定する。

---

### P1-45. score / hakkei が使う位置・速度fieldが明文化されていない

`MotionSample` には `rawHandPosition` と `handPosition` があり、`handPosition` は外れ値処理とfilter後の座標と定義されている。`docs/requirements.md` の処理図では `p_filtered` から上下/前後/発勁へ進むように読める。

一方、`SPEC.md` のscore章では `p_t`、`V_f`、`A_f`、`D_f` とだけ書かれており、上下/前後積算、Hakkei検出、HakkeiScore算出で `rawHandPosition`、`handPosition`、`velocity`、`acceleration` のどれを正とするかが章内で固定されていない。

根拠:

- `SPEC.md:468-490`
- `SPEC.md:1034-1057`
- `docs/requirements.md:153-159`
- `docs/requirements.md:334`

実装影響:

- charge積算をraw座標で行う実装とfiltered座標で行う実装に分かれ、静止jitter、score、Gate C/D1の期待値が変わる。
- Hakkeiの `forwardDisplacement200ms` をraw変位で見るかfiltered変位で見るかにより、誤検出率と反応性が変わる。
- scoreCalculator / hakkeiDetectorのfixtureで、同じMotionSample列から異なる結果が出る。

必要な解決:

- 通常score / hakkeiは `MotionSample.handPosition`、`velocity`、`acceleration` を使う、などfieldを固定する。
- raw座標を使う例外はCalibrationやraw jitter診断だけ、と明記する。
- fixtureにはrawとfilteredが異なるsample列を入れ、scoreがどちらを参照しているかをテストできるようにする。

---

### P1-46. `motion:diagnostics` の生成タイミングと送信周期が未定義

`MotionDiagnosticsPayload` は定義されているが、Mainがいつ生成し、どの周期でRendererへ送るかがない。jitterやdriftは2秒window、静止誤検出は10秒window、validSampleRatioはphase別条件を持つため、sample受信ごとに送るのか、定期timerで送るのか、要求時だけ送るのかで表示とGate判定が変わる。

根拠:

- `SPEC.md:665-677`
- `SPEC.md:779-783`
- `SPEC.md:963-990`
- `MILESTONES.md:201`
- `MILESTONES.md:346`
- `HUMAN_TEST_GUIDE_JA.md:498-504`

実装影響:

- 静止中に最新diagnosticsが更新されず、Human guideの2秒jitter確認で古い値を読んでしまう可能性がある。
- サンプル不足時に `null` を送り続ける実装と、payload自体を送らない実装に分かれ、UIとE2E testの期待が割れる。
- Gate Cの「`motion:diagnostics` にjitter、Hz、validSampleRatioが出る」を満たす条件が、画面表示なのかIPC payload受信なのか曖昧になる。

必要な解決:

- diagnostics生成ownerをMainに固定し、送信周期を定義する。例: active sourceについて `diagnosticsUpdateIntervalMs=250`。
- windowに必要なsample数を満たさない場合の `null`、`JITTER_WARN`、表示文言、更新継続条件を固定する。
- `motion:diagnostics` のIPCテストに「sample不足」「2秒window成立」「source切替」「session変更」を入れる。

---

### P1-47. `app:error-clear` の optional `code` / `source` の意味が未固定

`AppErrorClearPayload` は `code?` と `source?` を任意にしている。Rendererからの `app:error:clear` requestも `code?` を任意にしている。

しかし、`code` を省略した場合に全errorを消すのか、同一sourceだけ消すのか、UI上のdismissだけなのかが決まっていない。`source` 省略時のscopeや、`CONFIG_INVALID` のような `recoverable=false` fatalをclear対象にしてよいかも未定義。

根拠:

- `SPEC.md:647-663`
- `SPEC.md:760-761`
- `SPEC.md:1236-1261`
- `SPEC.md:1280`

実装影響:

- mode変更時の `app:error-clear` が、Unity由来warningだけでなく `VIDEO_MISSING`、`SCORE_INVALID`、`CONFIG_INVALID` まで消す実装になり得る。
- user-dismissedで根本原因が継続中のwarningを消した場合、次のstatus更新で再表示するのか、dismiss状態を保持するのかが割れる。
- RendererのError表示、diagnostic表示、`activeErrors` / `sourceStatuses[source].errors` の同期が崩れやすい。

必要な解決:

- `code` 省略時の意味を「指定sourceのrecoverable warning/errorを全clear」などに固定するか、省略を禁止する。
- `recoverable=false` のerrorは `app:error-clear` で消えない、またはアプリ再起動まで保持する、と明記する。
- `user-dismissed` はUI dismissだけかMain状態clearかを分け、必要なら `app:error-dismissed` 相当の別概念にする。

---

### P2-12. `sendRateHz` / `frameRate` と実測 `motionHz` / `heartbeatHz` の使い分けが弱い

Heartbeat packetにはUnity側報告値として `frameRate` と任意の `sendRateHz` がある。一方、statusにはElectron側で見える `motionHz` と `heartbeatHz` があり、Gate D1は実測受信Hzを条件にしている。

しかしInputCheckやGate判定で、Unity自己申告の `sendRateHz` / `frameRate` を表示参考に留めるのか、Electron実測の `motionHz` / `heartbeatHz` を正にするのかが明文化されていない。`motionHz` / `LOW_SAMPLE_RATE` の集計window問題とは別に、どのHzを判定値として使うかの契約が必要。

根拠:

- `SPEC.md:375-387`
- `SPEC.md:607-620`
- `SPEC.md:1244`
- `SPEC.md:1407-1408`
- `HUMAN_TEST_GUIDE_JA.md:476-483`

実装影響:

- Unity側 `sendRateHz=30` を信じてPASS表示にする実装と、Electronの実受信HzだけでPASS/NGを出す実装に分かれる。
- `frameRate` が50fpsでもUDP送信が10Hzしかない場合に、InputCheckが正常に見える不具合が起き得る。
- Gate D1の記録で「Unity側Send Hz」と「Electron側受信Hz」が混ざり、実際の入力安定性を誤判定する。

必要な解決:

- Gate、`LOW_SAMPLE_RATE`、InputCheck OK条件はElectron実測 `motionHz` / `heartbeatHz` を正とすると明記する。
- `sendRateHz` / `frameRate` はUnity診断参考値として別表示し、PASS/FAILには直接使わない、など役割を固定する。
- Human guideの送信Hz確認欄にも、Unity側報告値とElectron実測値を別フィールドで記録する。

---

## 追加未解決問題一覧（2026-06-06七次検証追記）

以下は、六次検証までの既存項目を重複確認したうえで追加する懸念。運用・安全・配布周辺だけのものは除外し、Keyboard fallback、Unity Bridge送信契約、score算出、Result表示、status整合など、現実の実装とテスト期待値に直接影響するものに限定する。

### P0-14. Keyboard Enter既定値がHakkei検出しきい値を満たさない可能性が高い

`SPEC.md` は、Enter押下で状態遷移を直接起こさず、Mainが200ms以内に前方向へ移動する疑似 `MotionSample` 列を生成し、通常のHakkei判定条件を満たした場合だけ `ImpactDelay` へ進むとしている。

しかしKeyboard sample生成の初期値は `Enter前方変位 = 0.22m / 200ms` であり、これを直線的な移動として実装すると平均前方向速度は `1.1m/s` になる。一方、Hakkei検出条件は `forwardVelocity > hakkeiMinForwardVelocity`、初期値は `1.2m/s` である。等速の疑似sample列では速度条件を満たせず、Keyboard fallbackのEnterが発勁にならない可能性がある。

根拠:

- `SPEC.md:509`
- `SPEC.md:515-518`
- `SPEC.md:1007-1022`
- `SPEC.md:1338-1340`
- `HUMAN_TEST_GUIDE_JA.md:254-265`
- `MILESTONES.md:121`

実装影響:

- 仕様通りにEnterを通常Hakkei判定へ通した実装ほど、Keyboard Gate A / D2でHakkeiReadyから進まない可能性がある。
- Enterだけ特別に `ImpactDelay` へ進める回避実装が生まれると、P1-17の通常経路維持と衝突する。
- 直線、ease-out、短パルスなど疑似sample波形によって検出結果が変わり、keyboardInput / hakkeiDetector fixtureの期待値が割れる。
- 10回連続Keyboard確認で、発勁検出ではなくtimeout fallbackで進んでいることを見落とす可能性がある。

必要な解決:

- Enter疑似sample列の波形、peak velocity、peak acceleration、生成sample数を固定し、既定しきい値を確実に満たすfixtureを追加する。
- 直線移動を採用するなら、`Enter前方変位 / 200ms` が `hakkeiMinForwardVelocity` を上回る値へ調整する、またはKeyboard用既定しきい値を明示する。
- Human guideに「Enterで通常Hakkei判定が成立した」ことをdiagnosticまたはResult内訳で確認する手順を追加する。

---

### P1-48. motion側availabilityとheartbeat側readinessが矛盾した時の優先順位がない

motion packetは `isTracked=false` または `avatar.hasRightHand=false` の場合に `isAvailable=false` の `MotionSample` を生成する。一方、heartbeat packetは `avatarReady=false` / `rightHandReady=false` をstatus warningや `app:error` warningにできる。

しかし同一source/sessionで、heartbeatは `rightHandReady=true` だがmotionは `avatar.hasRightHand=false`、またはheartbeatは `rightHandReady=false` だがmotionは有効sampleを送っている、といった矛盾状態の優先順位、clear条件、InputCheck OK判定への反映が決まっていない。

根拠:

- `SPEC.md:348`
- `SPEC.md:389`
- `SPEC.md:451-453`
- `SPEC.md:545-547`
- `SPEC.md:569-571`
- `SPEC.md:1241-1243`

実装影響:

- 最新motionが有効でも、1Hz heartbeatの古い `rightHandReady=false` が残ってInputCheckがNGのままになる実装があり得る。
- 逆にheartbeatがreadyなら、motion側 `NOT_TRACKED` / `RIGHT_HAND_UNAVAILABLE` を軽視してCalibrationやscoreへ進める実装が生まれ得る。
- `RIGHT_HAND_UNAVAILABLE` / `AVATAR_NOT_READY` / `NOT_TRACKED` の表示、`activeErrors`、`sourceStatuses[source].errors` のclearタイミングがpacket種別ごとに割れる。
- heartbeat 1Hzとmotion 30Hzの更新頻度差により、画面が一時的にOK/NG点滅する可能性がある。

必要な解決:

- sample availabilityはmotion packetを正、Bridge診断readinessはheartbeatを正、など用途別の優先順位を定義する。
- 矛盾時のstatus表示、`app:error` 発火、InputCheck OK、Calibration可否、warning clear条件を時系列で固定する。
- 矛盾fixtureを追加する。例: heartbeat ready + motion unavailable、heartbeat not ready + motion valid、heartbeat stale + motion recovered。

---

### P1-49. HakkeiScoreの正規化順序が `SPEC.md` だけでは決まらない

`docs/requirements.md` は、HakkeiScore算出で使う \(V_f\)、\(A_f\)、\(D_f\) を設定ファイル上のmin/maxで0〜100へ正規化した値とすると明記している。

一方 `SPEC.md` は `hakkeiRaw = 0.50 * V_f + 0.35 * A_f + 0.15 * D_f` と書くが、\(V_f\)、\(A_f\)、\(D_f\) が物理量のraw peakなのか、正規化済みcomponent scoreなのかを本文で固定していない。さらに変数名が `hakkeiRaw` のため、weighted sum後に再度0〜100正規化する実装にも読める。

根拠:

- `docs/requirements.md:832-842`
- `SPEC.md:1052-1064`
- `SPEC.md:1066-1088`
- `SPEC.md:1343-1345`

実装影響:

- raw物理量を直接weighted sumする実装、componentを0〜100へ正規化してからweighted sumする実装、weighted sum後にさらに正規化する実装に分かれる。
- 同じHakkei sample列でも `hakkeiScore`、`power`、`damageYen`、`videoLevel` が大きく変わる。
- `velocityWeight` / `accelerationWeight` / `displacementWeight` の意味が、単位付き物理量の重みなのか、0〜100 component scoreの重みなのか曖昧になる。
- scoreCalculatorの境界値fixtureで、期待値を固定できない。

必要な解決:

- HakkeiScore算出を `raw peak -> component score(0-100) -> weighted hakkeiScore(0-100)` のように段階名付きで定義する。
- `hakkeiRaw` という名前を使うなら、物理rawなのかweighted scoreなのかを明記する。必要なら `hakkeiVelocityScore`、`hakkeiAccelerationScore`、`hakkeiDisplacementScore` を `ScoreBreakdown` または内部型に追加する。
- requirementsとSPECの式・命名・fixture期待値を揃える。

---

### P1-50. Keyboard Space疑似上下入力の波形と周期が未定義

Keyboard sample生成の初期値には `Space上下振幅 = 0.10m` がある。Human guideでは「10秒間、Spaceを何度か押す」とされ、Space押下で上下チャージゲージが増えることを期待している。

しかしSpace押下時に、固定offsetへ移動するのか、押すたびに上下をtoggleするのか、押下中にsin波で上下動するのか、1回のkeydownで何msの疑似動作を出すのかが決まっていない。上下チャージは差分絶対値を積算するため、この波形差がそのままscore差になる。

根拠:

- `SPEC.md:500`
- `SPEC.md:515-516`
- `SPEC.md:523-525`
- `SPEC.md:1034-1037`
- `HUMAN_TEST_GUIDE_JA.md:220-231`
- `MILESTONES.md:119`

実装影響:

- Spaceを押しっぱなしにしても最初の0.10mだけ加点される実装と、押下中に継続加点される実装でKeyboard scoreが大きく変わる。
- OS key repeatを無視する仕様と、Human guideの「何度か押す」手順の関係が曖昧になる。
- Keyboard 10回連続確認で、操作担当者の押し方によって動画LvやResult内訳がばらつく。
- SpaceとA/D/Enterの合成時に、上下波形のphase resetやbaselineが実装者任せになる。

必要な解決:

- Spaceの疑似動作を、keydown単発pulse、pressed中oscillation、toggle stepなどのどれにするか固定する。
- 採用波形の周期、duration、peak変位、baseline復帰、mode/reset時のphase reset条件を `InputConfig.keyboard` の明示keyにする。
- keyboardInput / keyboardSampleGenerator testに、同じSpace操作列から期待verticalRawが再現されるfixtureを追加する。

---

### P1-51. Unity Bridge送信Hz制御と `seq` / `timestampMs` 発行基準が未固定

Unity Bridgeは `LateUpdate` でRightHand座標を読むこと、motion送信頻度は標準30Hz・可能なら50Hzであること、motion JSONに `seq` とsession相対 `timestampMs` を入れることが定義されている。

しかしC#側で `LateUpdate` 毎に送るのか、送信Hzに合わせてthrottleするのか、`seq` を送信成功時だけ増やすのか送信試行時に増やすのか、`timestampMs` を `Time.realtimeSinceStartup` 系で作るのか、UnityのtimeScale影響を受けるclockで作るのかが固定されていない。

根拠:

- `AGENTS.md:285-289`
- `SPEC.md:223`
- `SPEC.md:259-260`
- `SPEC.md:282-289`
- `SPEC.md:339-342`
- `MILESTONES.md:225-228`

実装影響:

- 高fps環境で `LateUpdate` 毎に送ると、標準30Hz想定を超え、filter/dt/velocity/LOW_SAMPLE_RATE判定のfixtureが変わる。
- 送信失敗時に `seq` を進める実装と進めない実装で、Electron側の `SEQ_GAP` と droppedFrameCount が変わる。
- Unityの一時停止やtimeScale変更の影響を受けるclockを使うと、`timestampMs` rollback/gap、速度・加速度、heartbeat timeoutの再現性が崩れる。
- Unity Bridge単体確認の `Send Hz` / `Last Seq` とElectron側の `motionHz` / `lastSeq` が一致しない原因を切り分けにくい。

必要な解決:

- C# senderの送信schedulerを定義する。例: `LateUpdate` で最新座標を読み、`sendIntervalMs` を満たした時だけUDP送信する。
- `seq` は「実際に送信したmotion datagramごとに1増加」、`timestampMs` は「session開始からのmonotonic realtime ms」など、発行基準を固定する。
- 送信失敗時のseq/timestamp、diagnostic表示、ログ、heartbeat継続可否を表にする。
- Unity Bridge sender unit相当の手動/ログ確認手順に、target sendHz、actual sendHz、seq増分、timestamp単調増加を入れる。

---

### P2-13. Resultの「コメント」表示契約がScoreBreakdownにもconfigにもない

UI要件ではResultに「コメント」を表示するとされているが、`ScoreBreakdown` にはコメントfieldがなく、`ScoreConfig` にもrankやvideoLevelに対応するコメント文言の設定がない。

根拠:

- `SPEC.md:1119-1127`
- `SPEC.md:1217-1225`
- `docs/requirements.md:1061-1069`
- `HUMAN_TEST_GUIDE_JA.md:286-301`

実装影響:

- ResultPresenterがrank、videoLevel、powerのどれからコメントを作るか実装者任せになる。
- コメントをコード固定にする実装と、config化する実装が分かれる。
- Debug Result Fixtureや境界値確認で、コメント表示をassertするのか任意表示にするのかが決まらない。
- 多言語化しない方針でも、固定文言をどこに置くかが不明なため、Result UI testの期待値が割れる。

必要な解決:

- コメントを必須表示にするなら、`ResultComment` の生成規則を定義する。例: rank別、videoLevel別、power帯別。
- 設定化する場合は `score.config.json` または `app.config.json` にコメントtableを追加し、欠損時のfallback文言を固定する。
- コメントをMVP対象外にするなら、UI要件とHuman guideから必須確認を外す。

---

## 追加未解決問題一覧（2026-06-06八次検証追記）

以下は、七次検証までの既存項目を重複確認したうえで追加する懸念。運用・安全・配布周辺だけのものは除外し、validator、MotionSample生成、filter、Hakkei検出、diagnosticsの実装とテスト期待値に直接影響するものに限定する。

### P1-52. 座標範囲validatorがUnityワールド原点依存になっている

motion JSONの `rightHand.x/y/z` は、絶対値10m超をinvalid、絶対値3m超をwarningと定義されている。一方、この値はUnityの `RightHand Transform.position`、つまりUnityワールド座標であり、Avatar rootやScene上の配置が原点付近であることは通信契約で保証されていない。

P0-10は軸入替・符号・scale補正configの不足を扱っているが、ここではvalidator自体の基準点がUnityワールド原点に固定されている点が別問題になる。原点から離れた位置にAvatarを置いただけで、実際には正常な右手運動でも `COORDINATE_RANGE_WARN` や `INVALID_MOTION_PACKET` になり得る。

根拠:

- `SPEC.md:344`
- `SPEC.md:489`
- `SPEC.md:878-887`
- `docs/requirements.md:196`
- `docs/requirements.md:471`

実装影響:

- Unity Scene上でAvatar rootが `x=5m` や `z=4m` 付近にあるだけで、入力品質と無関係なwarningが出る。
- Avatar rootが10m超の位置にある場合、右手が正常に動いていてもmotion packetがinvalidとして破棄される。
- InputCheck、Calibration、Gate C/D1が、センサー品質ではなくUnity Scene配置に依存して失敗する。
- mock fixtureが原点付近の座標だけだと、実Unity Bridgeで初めて範囲validatorの誤判定が出る。

必要な解決:

- `rightHand` はUnityワールド絶対座標のまま検証するのか、Avatar root相対またはCalibration後座標で範囲判定するのかを固定する。
- ワールド絶対座標を許すなら、`InputConfig.coordinates` に許容中心、最大半径、警告半径を持たせ、Scene配置に合わせて調整できるようにする。
- もしくはUnity Bridge payloadに `avatarRootPosition` を追加し、Electron側ではroot相対の右手座標をvalidator / filter / scoreの基準にする。
- 原点からオフセットした正常motion fixtureを追加し、warning/invalid境界が仕様通りになることを確認する。

---

### P1-53. EMA alphaがsample rate依存でUnity/Keyboard間のfilter挙動が揺れる

Unity Bridgeのmotion送信頻度は標準30Hz、可能なら50Hzで、Keyboard sample生成は60Hzとされている。一方、位置・速度・加速度のEMAは `positionEmaAlpha` などの固定alphaをsampleごとに適用する式になっている。

固定alphaをsample単位で適用すると、同じalphaでも30Hz、50Hz、60Hzで実時間上の平滑化強度が変わる。同じ腕の動きでも、入力sourceや実測Hzによってfiltered座標、速度ピーク、加速度ピーク、Hakkei検出、jitter指標が変わる。

根拠:

- `SPEC.md:259`
- `SPEC.md:515`
- `SPEC.md:945-958`
- `SPEC.md:1407`
- `docs/requirements.md:249`
- `docs/requirements.md:778-790`

実装影響:

- Keyboard fallbackの60Hz fixtureとUnity Bridgeの30Hz実入力で、同じ物理動作のHakkeiScoreが一致しない。
- Unity Bridgeが30Hzから50Hzへ変わっただけでfilterの時定数が変わり、Gate D1のjitterや発勁反応性が変わる。
- `positionEmaAlpha` を実測で調整しても、入力Hzが変わると再調整が必要になる。
- unit testが固定sample rate前提になり、30Hz/60Hzの境界バグを検出できない。

必要な解決:

- alphaを「target sample rate前提のsample alpha」とするか、「dtから計算するtime constant」とするかを固定する。
- dt対応にする場合は、例として `alpha = 1 - exp(-dtMs / timeConstantMs)` を採用し、`positionEmaTimeConstantMs` などのconfigへ置く。
- sample alpha方式を残す場合は、`filterTargetSampleRateHz` をconfigへ入れ、実測Hzが違うときの扱いを定義する。
- 30Hz、50Hz、60Hzの同一軌跡fixtureで、filter後の期待値または許容差をテストする。

---

### P1-54. `accelerationEmaAlpha` がconfigにあるが処理pipelineに適用段がない

`input.config.json` 例には `accelerationEmaAlpha` がある。しかし `SPEC.md` と `docs/requirements.md` の標準フィルタ処理図は、`VelocitySmooth -> Accel -> AccelClamp -> MotionSample` であり、加速度EMAをどこで適用するかが定義されていない。

加速度はHakkei検出とHakkeiScoreに直接使われるため、加速度EMAを適用するかどうか、適用するならclampの前か後かで検出感度とscoreが変わる。

根拠:

- `SPEC.md:917-921`
- `SPEC.md:953-958`
- `SPEC.md:1009-1011`
- `SPEC.md:1304-1306`
- `docs/requirements.md:746-750`
- `docs/requirements.md:786-790`

実装影響:

- `accelerationEmaAlpha` を無視する実装と、独自に加速度平滑化段を追加する実装に分かれる。
- clamp前に平滑化する実装と、clamp後に平滑化する実装で、外れ値混入時のHakkei検出結果が変わる。
- configに存在する値を変えても挙動が変わらない場合、調整担当者が原因を誤認する。
- `motionFilter` / `hakkeiDetector` のfixture期待値が、加速度平滑化の有無で一致しない。

必要な解決:

- 加速度EMAを採用するなら、pipelineに `AccelerationSmooth` を追加し、`Accel -> AccelerationSmooth -> AccelClamp` か `Accel -> AccelClamp -> AccelerationSmooth` のどちらかに固定する。
- 加速度EMAを採用しないなら、`accelerationEmaAlpha` をconfig例と型から削除する。
- `accelerationEmaAlpha` を変更した時にHakkei検出とHakkeiScoreがどう変わるかをunit testで固定する。

---

### P1-55. `forwardDisplacement200ms` の算出方法が未定義

Hakkei検出条件には `forwardDisplacement200ms > hakkeiMinForwardDisplacement` があるが、この200ms移動量をどう計算するかが定義されていない。

P1-20はHakkeiScore算出時の「直近または直後」評価窓を扱っているが、ここでは発勁を検出する条件そのものの移動量計算が未固定である点が別問題になる。

根拠:

- `SPEC.md:1000-1013`
- `SPEC.md:1023`
- `SPEC.md:1054-1064`
- `SPEC.md:1341`
- `docs/requirements.md:804-815`

実装影響:

- `now` と200ms前の位置差を見る実装、window内の前方向deltaを積算する実装、window内の最大値と最小値の差を見る実装に分かれる。
- 200ms境界にぴったりのsampleがない場合、補間するか、最も近いsampleを使うかで検出結果が変わる。
- 前へ出して少し戻した動作が、位置差方式では不検出、正方向積算方式では検出になる可能性がある。
- Keyboard Enterの `0.22m / 200ms` fixtureが、sample数や境界処理によって通ったり通らなかったりする。
- 30Hzと60Hzでwindow内sample数が違うため、同じ動作の検出結果が割れる。

必要な解決:

- `forwardDisplacement200ms` を「window開始位置から現在位置への射影差」「正方向delta累積」「window内max-min」などのどれにするか固定する。
- `hakkeiWindowMs` を検出用windowとHakkeiScore用windowで共用するのか、別configにするのかを明記する。
- window内sample不足時の扱い、境界sampleの補間有無、`validForScore=false` sampleの除外規則を固定する。
- 30Hz / 60Hz / sample不足 / 前進後戻りのfixtureを追加する。

---

### P2-14. `droppedFrameCount` と `invalidPacketCount` のscopeが未固定

`MotionSample.quality.droppedFrameCount` と `SourceStatusSnapshot.droppedFrameCount` が両方定義され、InputCheckにも `droppedFrameCount` が表示される。また、`invalidPacketCount` はsource statusにある。

しかし `droppedFrameCount` が「直前sampleから今回までの欠落推定数」なのか、「source/session内の累積数」なのか、「表示window内の合計」なのかが定義されていない。`invalidPacketCount` もsource単位、session単位、app起動後累積、mode切替後累積のどれかが未固定である。

根拠:

- `SPEC.md:341`
- `SPEC.md:479`
- `SPEC.md:624-625`
- `SPEC.md:1211-1213`
- `MILESTONES.md:196`
- `HUMAN_TEST_GUIDE_JA.md:374`
- `HUMAN_TEST_GUIDE_JA.md:390`

実装影響:

- `MotionSample.quality.droppedFrameCount` をdeltaとして扱う実装と累積値として扱う実装で、sample fixtureの期待値が割れる。
- InputCheckの `droppedFrameCount` が一度増えた後に戻らない実装と、windowが過ぎると戻る実装に分かれる。
- Result再プレイ、mode change、session changeでcountを保持するかresetするかが実装者任せになる。
- mockのseq gap確認で、画面上の数値が「今回欠落数」なのか「累積欠落数」なのか分からず、人間確認が不安定になる。

必要な解決:

- 例: `MotionSample.quality.droppedFrameCount` は直前accepted motionから今回までのdelta、`SourceStatusSnapshot.droppedFrameCount` はcurrent source/session内累積、といったscopeを固定する。
- `invalidPacketCount` もsource/session/globalのどれで数えるか、mode changeやsession changeでresetするかを固定する。
- InputCheck表示名を「今回欠落」「累積欠落」「直近window欠落」などに分ける。
- seq gap、timestamp gap、invalid JSON、session change、mode changeのcount fixtureを追加する。

---

## 追加未解決問題一覧（2026-06-06九次検証追記）

以下は、八次検証までの既存項目を重複確認したうえで追加する懸念。運用・安全・配布周辺だけのものは除外し、InputCheck表示、入力モード、validator、status payloadの実装とテスト期待値に直接影響するものに限定する。

### P1-56. InputCheckの現在座標 / dt表示に使うpayloadとstalenessが未定義

`SPEC.md` のInputCheck表示には「現在座標」と「dt」が必須項目としてある。

しかし `MotionStatusPayload` / `SourceStatusSnapshot` には現在座標や `dtMs` がなく、これらは `motion:sample` の `handPosition` と `quality.dtMs` をRendererが別途cacheして表示する必要がある。どのsource/sessionの最後のsampleを表示するか、timeout・mode変更・session変更・unavailable sample時に古い座標を消すか保持するかが固定されていない。

根拠:

- `SPEC.md:461-482`
- `SPEC.md:613-637`
- `SPEC.md:1199-1212`
- `HUMAN_TEST_GUIDE_JA.md:371`
- `HUMAN_TEST_GUIDE_JA.md:552`

実装影響:

- Unity Bridge停止後も最後の座標が「現在座標」として残り、InputCheckで受信OKのように見える可能性がある。
- modeをKeyboardへ切り替えた後にUnityの古いsampleを表示する実装と、座標欄を空にする実装でUI期待値が割れる。
- `motion:status` だけでInputCheckを描く実装では座標/dtを出せず、`motion:sample` cacheを併用する実装ではstaleness testが必要になる。

必要な解決:

- InputCheck用のview modelを定義し、`lastActiveMotionSample`、`lastSampleAgeMs`、表示対象source/session、stale時の表示を固定する。
- `motion:sample` cacheを使うなら、mode変更、session変更、timeout、`isAvailable=false` 時に座標/dtを保持するか、`対象外` / `未受信` に戻すかを明記する。
- InputCheckのunit/integration testに、sample受信後のtimeout、mode変更、session変更、unavailable sampleの表示期待値を追加する。

---

### P1-57. `InputMode="none"` の許可範囲と状態副作用が未定義

`InputMode` には `"none"` が含まれ、`AppConfig.defaultInputMode` と `input:set-mode` requestの `mode` も `InputMode` を受け取る。

一方、状態遷移表、Titleの入力モード選択、InputCheck表示、Gate条件では `none` の扱いが定義されていない。既存のP1-02はdiagnostics payloadが入力未選択を表せない問題だが、ここでは `none` mode自体をRendererから設定できるのか、設定した場合にMain側source状態やerror/warningをどう扱うかが未固定である点が別問題になる。

根拠:

- `SPEC.md:537`
- `SPEC.md:698`
- `SPEC.md:739-742`
- `SPEC.md:755-756`
- `SPEC.md:799-831`
- `SPEC.md:1203`

実装影響:

- `defaultInputMode="none"` を起動直後の内部状態として許す実装と、config不正扱いにする実装でGate Aの開始手順が変わる。
- Rendererから `setInputMode({ mode: "none" })` を呼べる場合、UDP受信を継続するか、active sourceを外すか、`UNITY_BRIDGE_TIMEOUT` / `LOW_SAMPLE_RATE` をclearするかが実装者任せになる。
- InputCheckで `none` を「未選択」と表示する実装と、到達不能状態として扱う実装でUI testとconfig fixtureが割れる。

必要な解決:

- `"none"` は起動直後の内部状態だけに許す、またはユーザー操作で選べる停止modeとして正式化する、のどちらかを固定する。
- `input:set-mode` で `"none"` を許す/拒否する条件、返す `IpcResult`、source status、warning/error clear、keyboard pressed state resetの副作用を表にする。
- `app.config.json` 例の `defaultInputMode` とTitle初期表示をこの方針へ合わせる。

---

### P2-15. `sessionId` の許容文字と正規化が実装可能な粒度で固定されていない

`sessionId` は「1〜64文字のASCII文字列」と定義されている。

しかしASCIIには空白、制御文字、DEL、引用符、パス区切りに見える文字なども含まれる。`sessionId` は `SourceStatusSnapshot.currentSessionId`、`StatusWarning` のscope、`AppErrorPayload.sessionId`、`motion:session-changed` にそのまま流れるため、validatorでどこまで許すか、表示前にどう正規化するかが固定されていない。

根拠:

- `SPEC.md:270-285`
- `SPEC.md:350`
- `SPEC.md:613-643`
- `SPEC.md:653-661`
- `SPEC.md:1278`

実装影響:

- `"unity 001"`、`"unity\t001"`、`"../session"`、日本語混入、DELなどのfixtureを受理するか `INVALID_SESSION_ID` 相当にするかが実装者ごとに割れる。
- warning集約scopeに見えない制御文字が混ざると、同じsessionに見える表示でも内部keyが別扱いになる可能性がある。
- `detailSafe` ではraw packet全文を出さない方針だが、sessionId自体の表示sanitize規則がないため、diagnostic表示とvalidator testが不安定になる。

必要な解決:

- `sessionId` の正規表現を固定する。例: `^[A-Za-z0-9._:-]{1,64}$`。
- 許可しない文字を含む場合のError codeをP1-14の共通field不正方針と合わせて固定する。
- 表示用sessionIdはvalidator通過済み文字列だけを出す、またはescape/置換規則を明文化する。

---

## 追加未解決問題一覧（2026-06-06十次検証追記）

以下は、九次検証までの既存項目を重複確認したうえで追加する懸念。運用・安全・配布周辺だけのものは除外し、座標変換、Renderer内Error、IPC response契約の実装とテスト期待値に直接影響するものに限定する。

### P1-58. `upVector` / `forwardVector` の正規化と座標補正適用順が未定義

上下チャージと前後チャージは `dot(p_t - p_{t-1}, upVector)` / `dot(p_t - p_{t-1}, forwardVector)` を積算する仕様になっている。

一方で、`rawHandPosition` は `axisMapping` と `scaleMultiplier` 適用後の座標とされているが、`upVector` / `forwardVector` がUnity元座標系のベクトルなのか、補正後座標系のベクトルなのか、また必ず単位ベクトルへ正規化するのかが定義されていない。

P0-10は座標補正configのschema不足、P1-18は `forwardVector` の採用優先順位を扱っているが、ここでは採用後のベクトルをどの座標空間で、どの長さ・直交条件でscoreへ渡すかが別問題になる。

根拠:

- `SPEC.md:489`
- `SPEC.md:878-887`
- `SPEC.md:1034-1047`
- `MILESTONES.md:211-213`
- `MILESTONES.md:254`

実装影響:

- `forwardVector` の長さが1でない場合、同じ手の移動でも `forwardRaw` とHakkeiの前方向成分が倍率付きで増減する。
- 軸入替・符号反転を手座標にだけ適用し、`upVector` / `forwardVector` に適用しない実装では、Calibration後も上下・前後判定がずれる。
- `upVector` と `forwardVector` が直交していない場合、上下チャージが前後チャージや発勁条件へ混入する。
- score unit testで、同じMotionSample列でもベクトル正規化の有無により境界値が変わる。
- `scaleMultiplier` 適用後の座標と未正規化ベクトルを併用すると、m、m/s、m/s²単位のしきい値が実質的に別単位になる。

必要な解決:

- 座標処理順を固定する。例: Unity座標受信 -> axis/sign/scale補正 -> filter -> Calibration vector算出 -> vector正規化 -> score/hakkei。
- `upVector` / `forwardVector` はscoreへ渡す前に有限数・非ゼロ・単位長へ正規化すると明記する。
- 必要なら `forwardVector` を `upVector` へ直交化するか、直交していない場合はCalibration失敗にする条件を固定する。
- axisMapping / sign / scale変更時に、Calibration済みベクトルを破棄するか再変換するかを明記する。
- 非単位ベクトル、軸入替、非直交ベクトルのfixtureを追加し、score期待値を固定する。

---

### P1-59. Renderer発生Errorの所有者と通知経路が未定義

`RendererInboundEvents` では `app:error` はMain -> RendererのIPC eventとして定義されている。

しかし `VIDEO_MISSING`、`VIDEO_DECODE_FAILED`、`VIDEO_STALLED`、`VIDEO_ENDED_TIMEOUT`、`AUDIO_MISSING`、`SCORE_INVALID` は、実際にはRenderer側の `videoManager`、`audioManager`、`scoreCalculator`、`resultPresenter` で発生する可能性が高い。

P1-15はseverityと画面遷移、P1-47はerror clearのscopeを扱っているが、ここではErrorを発生させるownerと通知経路そのものが未固定である点が別問題になる。

根拠:

- `SPEC.md:679-687`
- `SPEC.md:1140-1141`
- `SPEC.md:1238-1261`
- `MILESTONES.md:135-142`
- `MILESTONES.md:167-169`

実装影響:

- Renderer内で発生した動画・音声・スコアErrorを、Main由来の `app:error` と同じ型で扱う実装と、別のlocal stateで扱う実装に分かれる。
- RendererがMainへErrorを報告するIPCがないため、無理にMain経由へ寄せる実装では循環した責務や未定義channelが生まれる。
- `motion:status.activeErrors` / `sourceStatuses[source].errors` にRenderer由来Errorを載せるか載せないかが割れる。
- `app:error-clear` がMain由来Errorだけを消すのか、Renderer local Errorも消すのかが固定できず、VideoPlayback復帰やResult再プレイのテストが不安定になる。
- `VIDEO_MISSING` の不足ファイル名表示を `detailSafe` で出すのか、Renderer local payloadで持つのかが実装者任せになる。

必要な解決:

- Error modelを「Main-origin」と「Renderer-origin」に分けるか、共通 `AppError` 型をIPC外でも使うかを固定する。
- Renderer発生ErrorはstateMachineへlocal actionとして投入する、またはRenderer -> Mainの `app:error:report` 相当を追加する、のどちらかに決める。
- `activeErrors` / `sourceStatuses.errors` は入力source由来だけに限定するのか、Renderer local Errorも含めるのかを明記する。
- `app:error-clear` がRenderer local Errorへ効く条件、VideoPlayback離脱時、Result再プレイ時、manual reset時のclear条件を表にする。
- videoManager / audioManager / scoreCalculatorのError fixtureで、Error画面遷移、messageJa、detailSafe、clear条件をassertする。

---

### P2-16. `MODE_UNAVAILABLE` / `INVALID_REQUEST` の固定条件と文言がない

`IpcResult` の失敗形は、`AppErrorCode` に加えて `"MODE_UNAVAILABLE"` と `"INVALID_REQUEST"` を返せる型になっている。

しかしError code固定表は `AppErrorCode` だけを対象にしており、この2つのresponse専用codeについて、どのIPCで返すか、固定 `messageJa`、副作用、`app:error` 併発有無が定義されていない。

根拠:

- `SPEC.md:591-593`
- `SPEC.md:754-762`
- `SPEC.md:1238-1261`
- `SPEC.md:1260`

実装影響:

- runtime payload不正を `INVALID_REQUEST` で返す実装と、`IPC_CONTRACT_VIOLATION` の `app:error` にする実装でIPC testが割れる。
- `input:set-mode` で使えないmodeを指定した時に、`MODE_UNAVAILABLE`、`INVALID_REQUEST`、`CONFIG_INVALID` のどれを返すかが実装者任せになる。
- `keyboard:control` を非Keyboard modeで呼んだ時、no-op成功にするか `MODE_UNAVAILABLE` にするかでKeyboard fallbackのテストが変わる。
- `calibration:set-state` や `input:reset-filter` の失敗時に、Main側状態を変更しない保証が文書化されていない。
- `messageJa` が固定されないため、preload / IPC unit testでエラー文言をassertしづらい。

必要な解決:

- `MODE_UNAVAILABLE` と `INVALID_REQUEST` をresponse専用codeとして定義し、固定 `messageJa` と使うIPCを表にする。
- payload schema違反は `INVALID_REQUEST` response、preload/API契約破壊は `IPC_CONTRACT_VIOLATION` `app:error` など、層ごとの使い分けを固定する。
- 各Renderer -> Main requestについて、失敗時に状態変更、session更新、filter reset、keyboard pressed state変更を行わないことを明記する。
- response専用codeでは `app:error` を併発するかどうかを固定する。併発しないならRenderer側はinline command errorとして表示する、などUI扱いも決める。
- `input:set-mode`、`keyboard:control`、`calibration:set-state`、`input:reset-filter` の失敗fixtureを追加する。

---

## 追加未解決問題一覧（2026-06-06十一検証追記）

以下は、十次検証までの既存項目を重複確認したうえで追加する懸念。運用・安全・配布周辺だけのものは除外し、Keyboard入力経路、状態遷移テスト、error clear scope、score config validationの実装とテスト期待値に直接影響するものに限定する。

### P1-60. `R` / `Esc` がKeyboard入力仕様にあるがIPC payloadから抜けている

Keyboard入力仕様と手動確認では `Space` / `A` / `D` / `Enter` / `R` / `Esc` を検出対象にしている。

しかし `KeyboardControlPayload` は `key: "Space" | "KeyA" | "KeyD" | "Enter"` だけを許容しており、`R` と `Esc` をMainへ渡すtyped routeがない。`R` / `Esc` をRenderer-local commandにするのか、MainのKeyboard pressed stateやsession resetと同じ経路に載せるのかが未定義。

既存のP1-25はreset / replay / R / Escの遷移先と破棄範囲、P1-42はkey識別子とpressed state expiryを扱っているが、`R` / `Esc` がIPC payload型から欠落している点は別問題として残る。

根拠:

- `SPEC.md:498-526`
- `SPEC.md:744-746`
- `SPEC.md:757`
- `SPEC.md:773`
- `SPEC.md:832-847`
- `MILESTONES.md:109`
- `MILESTONES.md:118`
- `HUMAN_TEST_GUIDE_JA.md:117-127`

実装影響:

- `keyboardInput.ts` はR/Escを検出するが、Mainが持つKeyboard pressed stateや `app:reset-play` と同期しない実装になりやすい。
- `Esc` がRendererだけでTitleへ戻る場合、Main側の疑似入力session、seq、pressed state、filter baselineが古いまま残る可能性がある。
- `R` が `app:reset-play` commandなのか、keyboard control eventなのかが曖昧で、preload / IPC / stateMachine testの期待値が割れる。
- 非Keyboard mode中にR/Escを受け付けるかどうかも `keyboard:control` の `MODE_UNAVAILABLE` 条件と衝突する。

必要な解決:

- `R` / `Esc` をRenderer-local commandにするか、`KeyboardControlPayload` へ `"KeyR"` / `"Escape"` を追加するかを固定する。
- Renderer-localにする場合は、`R` / `Esc` 押下時に `app:reset-play`、video/audio停止、keyboard pressed state破棄、filter reset、Error clearをどの順で実行するかを明記する。
- Main routeにする場合は、`keyboard:control` のmode制約、repeat無視、keyup要否、session更新有無を固定する。
- `keyboardInput`、preload、stateMachine、resetPlayのfixtureにR/Escを追加する。

---

### P1-61. `stateMachine` のevent / guard / side effect契約が型として定義されていない

状態図では `Start`、`Unity Bridge入力OK`、`Keyboard入力で開始`、`動画終了`、`R`、`Esc`、`Error発生` などの遷移ラベルがある。

しかし `stateMachine.ts` が受け取るevent union、guard入力、遷移時に返すside effect / commandが仕様化されていない。既存項目は個別の遷移やtimer値を扱っているが、純粋関数としてテストできる状態遷移契約そのものが未定義のまま。

根拠:

- `SPEC.md:795-847`
- `SPEC.md:679-687`
- `SPEC.md:757-761`
- `MILESTONES.md:110`
- `MILESTONES.md:118-122`

実装影響:

- 実装者が `START`、`INPUT_OK`、`HAKKEI_DETECTED`、`VIDEO_ENDED` などのevent名やpayloadを推測で作ることになる。
- `score reset`、`timer start`、`video load`、`audio stop`、`calibration reset`、`app:error-clear` などの副作用がDOM/UI処理へ混ざりやすく、TypeScriptの純粋関数テストが弱くなる。
- `Error` 復帰、session change、R/Esc、InputMode変更時の破棄範囲をstateMachine testだけで検証できない。
- 同じ遷移がRenderer UI、inputManager、videoManagerの複数箇所で二重実装されるリスクがある。

必要な解決:

- `StateMachineEvent`、`StateMachineContext`、`StateMachineCommand` の型を定義する。
- 遷移関数は `previousState + event + context -> nextState + commands` の純粋関数にするか、少なくとも副作用一覧を返す形に固定する。
- `START_SELECTED_MODE`、`INPUT_OK`、`CALIBRATION_DONE`、`PHASE_TIMER_EXPIRED`、`HAKKEI_DETECTED`、`VIDEO_ENDED`、`APP_ERROR`、`RESET_PLAY`、`ESC_TO_TITLE` などのeventとpayloadを表にする。
- 各状態で許可されないeventの扱いをno-op、warning、`INVALID_REQUEST` のどれにするか固定し、stateMachine unit testへ落とす。

---

### P1-62. `app:error-clear` に `sessionId` がなくsession scoped errorを安全に消せない

`StatusWarning` と `AppErrorPayload` は `sessionId` を持てるが、`AppErrorClearPayload` は `code?` と `source?` だけで `sessionId` を持たない。

そのため、旧sessionで発生したerrorと現sessionで発生した同一 `code + source` のerrorを区別してclearできない。逆に、旧sessionの復帰通知が遅延した場合に現sessionのerrorを誤って消す可能性もある。

既存のP1-47は `code?` / `source?` の省略時意味を扱い、P1-44はmotion/heartbeat session mismatchを扱っているが、clear payload自体のsession scope欠落は未解決。

根拠:

- `SPEC.md:554-563`
- `SPEC.md:647-663`
- `SPEC.md:679-687`
- `SPEC.md:760-761`
- `SPEC.md:287-291`
- `SPEC.md:639-645`

実装影響:

- Unity Bridge再起動やMock切替直後に、旧sessionの `UNITY_BRIDGE_TIMEOUT` clearが現sessionのerrorを消す可能性がある。
- `motion:session-changed` 後にactiveErrorsを全消しする実装と、source単位で残す実装でUI表示とテストが割れる。
- Rendererから `app:error:clear` を呼ぶ時に、現在のsessionだけを対象にするのか、source全体を対象にするのか判断できない。
- stale clearを無視するfixtureを作れず、session更新時のError復帰テストが弱くなる。

必要な解決:

- `AppErrorClearPayload` とRenderer requestへ `sessionId?: string | null` を追加するか、clearはsession非依存でsource全体を消す仕様だと明記する。
- `sessionId` 指定あり、`sessionId: null`、未指定の意味を固定する。
- session change時に旧sessionのactiveErrorsをどう扱うか、`motion:session-changed` と `app:error-clear` の順序を固定する。
- 旧session clearが現session errorを消さないfixture、source全体clearのfixture、Renderer manual clearのfixtureを追加する。

---

### P1-63. `ScoreConfig` の数値整合条件が `CONFIG_INVALID` として固定されていない

P1-21ではconfig schemaの構造と型の不足、P1-24ではvideo level包含規則、P1-34では `ScoreBreakdown` invariantが指摘されている。

しかし `ScoreConfig` そのものの数値整合条件がまだ固定されていない。特に正規化式は `RawMax - RawMin` で割るため、`RawMax <= RawMin`、NaN、Infinity、負係数、weight合計不一致を許すとscore / power / damage / video levelが実装者ごとに変わる。

根拠:

- `SPEC.md:1066-1088`
- `SPEC.md:1091-1111`
- `SPEC.md:1326-1358`
- `SPEC.md:1258`
- `UNRESOLVED_ISSUES_CURRENT.md:858-881`
- `UNRESOLVED_ISSUES_CURRENT.md:1078-1100`
- `UNRESOLVED_ISSUES_CURRENT.md:1594-1626`

実装影響:

- `verticalRawMax == verticalRawMin` や `forwardRawMax < forwardRawMin` でdivision by zeroまたは負の正規化が起きる。
- `verticalWeight + forwardWeight + impactWeight` が1でない場合、`HakkeiScore` をclamp前に正規化する実装とweightを再正規化する実装で結果が変わる。
- `powerCoefficient` / `yenCoefficient` が0、負数、NaN、Infinityの時に、表示とvideo level選択の境界が破綻する。
- `videoLevels` がlevel欠落、重複、未ソート、範囲gap/overlapを持つ時、`selectVideoLevel` のfallbackが実装者任せになる。
- `CONFIG_INVALID` にするか、安全なdefaultへfallbackするかが未定義で、起動時testと画面表示が割れる。

必要な解決:

- `ScoreConfig` validatorで必須key、finite number、range、相互関係を表にする。
- `verticalRawMax > verticalRawMin`、`forwardRawMax > forwardRawMin`、weightはfiniteかつ非負、合計は1固定またはvalidator内で再正規化のどちらかに決める。
- `powerCoefficient` と `yenCoefficient` はfiniteかつ `> 0` にするか、0を許すなら表示・video選択上の意味を明記する。
- `videoLevels` はLv0〜Lv5を過不足なく持ち、`minPower` 昇順、gap/overlapなし、Lv0の下限、Lv5の上限表現を固定する。
- それぞれの違反で返す `CONFIG_INVALID detailSafe` とfixture名を固定する。

---

## 追加未解決問題一覧（2026-06-06十二次検証追記）

以下は、十一検証までの既存項目と重複しないように再確認したうえで追加する懸念。運用・安全・配布周辺だけのものは除外し、実装責務、session lifecycle、Keyboard通常経路、Gate技術判定、設定化順序に直接影響するものに限定する。

### P1-64. `staticFalseHakkeiCount10s` の生成責務がMain->Renderer payloadとRenderer側Hakkei判定で衝突している

`MotionDiagnosticsPayload` はMain -> Renderer payloadとして定義され、その中に `staticFalseHakkeiCount10s` が含まれている。

一方で、仕様上のスコア・状態はRenderer内の各モジュールが扱い、`hakkeiDetector.ts` もRenderer側モジュールとして配置されている。静止発勁誤検出数をMainが生成するならMain側にもHakkei判定ロジックが必要になり、Rendererが生成するなら `motion:diagnostics` の送信方向とpayload ownerが合わない。

既存のP1-39は10秒静止測定の経路そのものを扱っているが、ここでは `staticFalseHakkeiCount10s` を誰が計算してどのIPCで運ぶかという責務境界の問題が未解決。

根拠:

- `SPEC.md:92-93`
- `SPEC.md:146-159`
- `SPEC.md:665-677`
- `MILESTONES.md:201-202`
- `MILESTONES.md:256-260`

実装影響:

- MainにHakkei判定の簡易版を置く実装と、Rendererだけで計測する実装に分かれる。
- Main / Rendererで発勁判定条件、cooldown、`validForScore` の扱いが二重化し、静止誤検出テストの期待値が割れる。
- `motion:diagnostics` のunit testで、Main側fixtureを見るのかRenderer側detector fixtureを見るのかが決まらない。
- M7-09の「静止発勁0回テスト」が、M11-06の `hakkeiDetector` 実装より前に置かれているため、仮detectorを作るか、テストを後ろへ送るかの判断が実装者任せになる。

必要な解決:

- `staticFalseHakkeiCount10s` をMainが計算するなら、Main側に置ける純粋なHakkei判定関数を共有モジュール化し、Renderer score経路と同一関数を使うと明記する。
- Rendererが計算するなら、`MotionDiagnosticsPayload` からこのfieldを外すか、Renderer-local diagnostics payloadとして別定義にする。
- M7-09をM11以降へ移す、またはM7では「静止sample列fixtureを保存する」だけにして、発勁判定assertはM11で行う。
- 静止誤検出countのowner、入力field、cooldown reset、`validForScore=false` sample除外条件をfixture化する。

---

### P1-65. Unity / Mock Bridgeの `sessionId` 生成・更新タイミングが固定されていない

`sessionId` はUnity Bridge再起動やMock切替を明示するために必須とされ、session変更時には旧sessionの `seq` や `timestampMs` と比較しないと定義されている。

しかしUnity BridgeやMock senderが `sessionId` をいつ生成し、いつ更新し、motionとheartbeatでどう共有するかが固定されていない。M9のUnity Bridge実装タスクにも、`seq` とheartbeatはあるが `sessionId` lifecycleの作業がない。

根拠:

- `SPEC.md:282`
- `SPEC.md:289`
- `SPEC.md:291`
- `SPEC.md:1380`
- `MILESTONES.md:221-229`

実装影響:

- Unity Bridgeが固定 `sessionId` を使うと、Bridge再起動後に `seq` / `timestampMs` が0へ戻った時、Electronが `SEQ_ROLLBACK` / `TIMESTAMP_ROLLBACK` として通常入力を破棄する可能性がある。
- datagramごとに新しい `sessionId` を作る実装では、`motion:session-changed`、filter reset、Calibration破棄が毎フレーム発生する。
- motionとheartbeatで別々に `sessionId` を生成すると、既存P1-44のsession mismatchが常時起きる。
- Mock異常系scriptの再起動、heartbeat stall、timestamp rollbackのfixtureで、session更新の有無によって期待errorが変わる。

必要な解決:

- Unity Bridge / Mock senderは「プロセス起動またはmock run開始時に1つの `sessionId` を生成し、motionとheartbeatで共有し、manual session resetまたは再起動まで変えない」などのlifecycleを固定する。
- `seq` と `timestampMs` は新 `sessionId` と同時にbaseline resetする、と明記する。
- M9に `sessionId` 生成・診断表示・motion/heartbeat共有確認のタスクを追加する。
- Mock scriptには、通常run、同一session rollback、session更新後resetのfixtureを分けて用意する。

---

### P1-66. M2のKeyboard MotionSample実装順がMain generator / preload IPC契約と噛み合っていない

`SPEC.md` では、Keyboard入力もRendererから直接scoreへ入れず、Mainの `keyboardSampleGenerator` が疑似 `MotionSample` を生成すると定義している。RendererからMainへは `keyboard:control` とpreload APIを通す構造になっている。

しかし `MILESTONES.md` のM2では、M5のtyped IPC / preload実装より前に、`keyboardInput.ts`、疑似handPosition生成、Keyboard `MotionSample` 化、Enter反応を完了する流れになっている。

既存のP0-01はMain / Renderer責務の資料衝突、P1-17はEnter直接発勁の余地、P1-60はR/Esc payload欠落を扱っているが、ここではM2/M5の実装順が正しいKeyboard通常経路を作りにくい点が別問題になる。

根拠:

- `SPEC.md:434`
- `SPEC.md:507-509`
- `SPEC.md:739-746`
- `SPEC.md:770-785`
- `MILESTONES.md:118-124`
- `MILESTONES.md:165-173`

実装影響:

- M2を素直に進めると、Renderer側で疑似位置や `MotionSample` を作り、あとでMain generatorへ移す手戻りが発生する。
- Keyboard Gate Aの縦通しだけRenderer-local sampleで通り、M5以降の `motion:sample.source="keyboard"` 経路と別物になる可能性がある。
- `keyboardInput.ts` unit testと `keyboardSampleGenerator.ts` unit testの責務が曖昧になり、同じキー操作fixtureを二重管理しやすい。
- preload未実装の段階でM2-09を完了扱いすると、Gate Aの「Main生成MotionSample」を確認できない。

必要な解決:

- M2開始前に最小 `keyboard:control` IPC、preload `sendKeyboardControl`、Main `keyboardSampleGenerator` を前倒しする。
- もしくはM2ではRenderer-local仮実装を明示的に `TODO: TEMP_M2_KEYBOARD_RENDERER_ONLY` とし、Gate A通過条件からは除外する。
- M2-04 / M2-09の成果物を「Main生成のKeyboard MotionSample」へ書き換える。
- Keyboard fixtureはDOM key event -> preload payload -> Main generator -> `motion:sample` までを同じテストデータで検証する。

---

### P1-67. Gate Aの通過条件が資料間で弱くなっている

`SPEC.md` のGate Aは、Keyboard由来 `MotionSample` がMain生成で流れること、Powerに応じたローカルmp4再生、損害額・ランク・内訳表示、10回連続Keyboardプレイを要求している。

一方 `MILESTONES.md` のGate A summaryでは、Lv0または仮動画再生、再プレイまでで、Main生成 `MotionSample`、Power連動動画、スコア内訳、10回連続確認がGate条件として明示されていない。M2-14やREADME/checklistには10回確認があるため、資料間でGate Aの強さが揺れている。

根拠:

- `SPEC.md:1368-1375`
- `MILESTONES.md:316-327`
- `MILESTONES.md:127-129`
- `README.md:23-31`
- `docs/verification_checklist.md:24-25`

実装影響:

- MILESTONESのGate Aだけを根拠にすると、Keyboard fallbackの耐久性が未確認のままUnity Bridge統合を広げられる。
- Lv0固定または仮動画だけでGate A PASSとなり、Power連動video selectorやScoreBreakdown表示の不具合が後続Gateまで残る。
- `motion:sample.source="keyboard"` を通っていないRenderer-local実装でもGate Aを通せるように読める。
- Gate A PASS / FAILの記録が、SPEC準拠の厳しい判定とMILESTONES準拠の緩い判定に分かれる。

必要な解決:

- Gate A条件を `SPEC.md`、`MILESTONES.md`、README、checklistで同一表にする。
- Gate Aには `motion:sample.source="keyboard"`、Main生成、Power連動動画、ScoreBreakdown表示、10回連続完走を必須として明記する。
- Lv0仮動画だけの確認はGate A前のM3-06単体確認として分ける。
- Gate A記録テンプレートに「10回連続」「source=keyboard」「Powerに応じた動画」「ScoreBreakdown表示」を入れる。

---

### P2-17. M3のscore / video実装がM4設定化より先で、仮ハードコードの許容範囲が未定義

AGENTSとMILESTONESの完了条件では、設定値を `config/*.json` から読む構造にし、必要以上にハードコードしないことが求められている。

しかしマイルストーン順では、M3でscore計算、Power計算、damageYen、動画レベルしきい値を実装し、M4で `config/app.config.json`、`input.config.json`、`score.config.json` とschema validateを作ることになっている。M3時点でしきい値や係数をどこに置くか、仮ハードコードを許すならいつまでに除去するかが未定義。

根拠:

- `AGENTS.md:272-280`
- `MILESTONES.md:45-51`
- `MILESTONES.md:135-142`
- `MILESTONES.md:148-152`

実装影響:

- M3で `scoreCalculator.ts` や `videoManager.ts` にしきい値を直書きし、M4で取り切れない手戻りが発生する。
- M3 unit testが直書きdefaultを前提に固定され、M4でconfig読み込みへ変えた時にfixtureを全面更新する必要が出る。
- `videoLevels`、`powerCoefficient`、`yenCoefficient`、normalization min/maxの単一source of truthが一時的に複数化する。
- M3完了時点で「Definition of Doneを満たした」と扱うか、「M4までBLOCKED」と扱うかが実装者ごとに割れる。

必要な解決:

- M3で使うscore/video default値は、ファイル読み込み前でも `defaultScoreConfig` のような単一定数に集約し、M4でJSON読込に差し替える方針を明記する。
- 直書き仮実装を許すなら、M3完了記録に `TODO: REMOVE_M3_DEFAULTS_IN_M4` を必須化し、M4-05で削除確認を行う。
- M3 unit testはconfig objectを引数に渡す形で書き、ファイルI/OだけをM4の責務に分ける。
- M4完了条件に、M3で入ったscore/video default値の残存grepとfixture再確認を追加する。

---

## 追加未解決問題一覧（2026-06-06十三次検証追記）

以下は、十二次検証までの既存項目と重複しないように再確認したうえで追加する懸念。運用・安全・配布周辺だけのものは除外し、入力mode lifecycle、preload購読解除、Unity Bridge単体確認と責務境界に直接影響するものに限定する。

### P1-68. `input:set-mode` の許可状態とプレイ中切替時の遷移先が未定義

`input:set-mode` はRenderer -> Main requestとして定義され、Gate Cや要件文書ではKeyboardへ即時切替できることが求められている。

しかし状態遷移表では、入力モード選択やKeyboard切替は主にTitle / InputCheckに置かれており、VerticalCharge / ForwardCharge / HakkeiReady / VideoPlaybackなどのプレイ中に `setInputMode({ mode: "keyboard" })` を受けた場合の遷移先と副作用が固定されていない。

既存のP1-25は `R` / `Esc` / replayのreset scope、P1-31は非active source packet、P1-57は `InputMode="none"` を扱っているが、ここでは `input:set-mode` そのものをどの状態で許可し、プレイ中切替を継続・破棄・再開のどれにするかが未解決。

根拠:

- `SPEC.md:739-742`
- `SPEC.md:756`
- `SPEC.md:772`
- `SPEC.md:799-831`
- `SPEC.md:1397`
- `SPEC.md:1420-1425`
- `MILESTONES.md:187`
- `MILESTONES.md:245`
- `MILESTONES.md:348`
- `docs/requirements.md:1134-1135`
- `docs/requirements.md:1183-1184`
- `docs/requirements.md:1237-1243`
- `HUMAN_TEST_GUIDE_JA.md:811-823`

実装影響:

- プレイ中にUnity BridgeからKeyboardへ切り替えた時、現在のscore/timer/Calibrationを保持して続行する実装、InputCheckへ戻す実装、Titleへ戻す実装に分かれる。
- `input:set-mode` をTitle / InputCheck以外で拒否する場合、Gate Cの「即時切替」とHUMAN guideのKeyboard切替確認が別物になる。
- プレイ中切替で `app:reset-play`、`input:reset-filter`、Keyboard `sessionId` 更新、`app:error-clear` をどの順で行うかが実装者任せになり、source混入や古いscore残存が起き得る。
- fallback確認のE2E testで、切替後に `Ready` から再開するのか、`InputCheck` に戻るのか、現在phaseをKeyboard sampleで続けるのか期待値が固定できない。

必要な解決:

- 状態ごとの `input:set-mode` 許可表を定義する。例: Title / InputCheckのみ許可、または全状態で許可するがプレイ中は必ず現在プレイを破棄してInputCheckへ戻す。
- プレイ中切替を許す場合は、score、timer、video/audio、Calibration、filter、Keyboard pressed state、source status、active error/warningの保持/破棄をreset scope表に追加する。
- `input:set-mode` 成功時の副作用順を固定する。例: active mode変更 -> old source error clear -> keyboard pressed state reset -> keyboard session更新 -> filter baseline reset -> `motion:session-changed`。
- fixtureとして、ForwardCharge中にUnity BridgeからKeyboardへ切り替えるケース、HakkeiReady中に切り替えるケース、VideoPlayback中に切り替えるケースを追加する。

---

### P1-69. preload購読解除のライフサイクルが実装タスクと検証項目に落ちていない

`SPEC.md` は、各preload購読関数が `Unsubscribe` を返し、Rendererの画面再初期化、HMR、Titleへの戻り、Error復帰時にunsubscribeを呼ぶと明記している。

一方、M5-16とchecklistは購読口の存在確認が中心で、既存P1-43も「全Inbound APIの購読口があるか」と「`Unsubscribe` が返るか」を扱っている。実際にどのRenderer lifecycleでunsubscribeを呼ぶか、二重購読をどう検出するか、stateMachine / app.ts / 各panelのどこが購読所有者になるかは未定義のまま。

根拠:

- `SPEC.md:535`
- `SPEC.md:779-789`
- `MILESTONES.md:173`
- `MILESTONES.md:278`
- `docs/verification_checklist.md:31`

実装影響:

- Title復帰、Result再プレイ、Error復帰、HMR後に古いhandlerが残ると、1つの `motion:sample` が複数回処理され、charge積算、Hakkei検出、Error表示、video終了処理が二重に走る可能性がある。
- preload単体テストで購読関数の存在だけを確認しても、Renderer統合時のlistener leakを検出できない。
- `onAppErrorClear` や `onMotionSessionChanged` が二重登録されると、reset/filter/session破棄の副作用が複数回実行され、P1-25やP1-62の問題と組み合わさって再現しにくい状態不整合になる。
- panel単位で購読する実装とapp rootで一括購読する実装に分かれ、どの画面遷移で解除すべきかがレビューしづらい。

必要な解決:

- Renderer側の購読所有者を定義する。例: `app.ts` が全preload購読を一括管理し、画面componentはlocal callbackだけ登録する。
- `Unsubscribe` を呼ぶ状態遷移を表にする。Title復帰、Result replay、Error復帰、HMR、window unload、diagnostic panel再生成などを含める。
- preload testに「unsubscribe後はhandlerが呼ばれない」「unsubscribeの二重呼びが安全」「同一eventを再購読しても古いhandlerが残らない」を追加する。
- Renderer integration testに、Result再プレイ後の `motion:sample` 1件でscoreが1回だけ進むこと、Error復帰後に `app:error-clear` が1回だけ処理されることを追加する。

---

### P1-70. Unity Bridge単体確認にElectron Calibration後の前方向成分が混ざっている

Unity Bridge単体確認の手順で、右手を前に出し「キャリブレーション後の前方向成分」を見る、とされている。

しかしUnity Bridgeの責務はReceiver / Avatar / RightHand取得 / UDP送信 / 診断ログに限定され、Calibrationと `forwardVector` の確定はElectron側の状態・score経路に属している。Unity Bridge診断表示の最低項目も、Receiver、Avatar、RightHand、Send Hz、Heartbeat Hz、Target、Last Seq、RightHand位置であり、Electron Calibration後の前方向成分をUnity Bridge単体で表示する契約はない。

既存のP1-36は `avatarRoot.transform.forward` に必要なUDPデータ不足を扱っているが、ここでは人間確認手順がUnity Bridge単体にElectron Calibration由来の値を要求しており、責務境界を誤って実装させるリスクが別問題になる。

根拠:

- `SPEC.md:200-211`
- `SPEC.md:231-244`
- `SPEC.md:872-887`
- `MILESTONES.md:209-215`
- `MILESTONES.md:221-230`
- `HUMAN_TEST_GUIDE_JA.md:450-464`

実装影響:

- 手順どおり確認しようとすると、Unity Bridge単体では前方向成分を表示できず、Gate B1相当の確認が曖昧になる。
- 実装者が手順を満たすために、Unity Bridge側へCalibration、forward projection、score補助計算を入れてしまう可能性があり、Unity Bridgeにゲーム本体責務を入れない原則と衝突する。
- 逆にElectron接続後のCalibration結果を見るだけの実装では、Unity Bridge単体確認の合格条件を満たしたかどうかが判断しづらい。
- 前後確認の失敗原因が、Unity BridgeのRightHand取得問題なのか、Electron側のCalibration / axisMapping問題なのか切り分けにくくなる。

必要な解決:

- Unity Bridge単体確認では、RightHandの生座標またはUnityローカルな診断値だけを見るようにする。例: 上下は `rightHand.y`、前後はUnity上の表示座標やAvatar root基準の簡易ログに限定する。
- 「キャリブレーション後の前方向成分」は、Unity Bridge + Electron確認またはCalibration確認へ移す。
- Unity Bridge診断に前方向候補を出す必要があるなら、Electron Calibrationとは別の `avatarForwardDot` など診断専用fieldとして定義し、score / state管理へ使わないと明記する。
- BridgeStatusViewの表示ラベルは `RightHand Ready` と `RightHand Position` のように分け、RightHand状態と座標表示を混同しない。

---

## 追加未解決問題一覧（2026-06-06十四次検証追記）

以下は、既存P0-01〜P1-70と重複しないものだけを追加する。運用・安全・配布周辺ではなく、実装と手動確認の分岐に直結するものに限定している。

### P1-71. Calibration失敗時の理由・表示・Error契約がない

`CalibrationStatePayload` は `state="failed"` を表せるが、失敗理由、対象source/session、直近quality、Errorへ上げるかどうかの契約がない。

既存P1-03はCalibration成功条件の粒度不足、P1-33は成功結果の保持scope不足を扱っている。ここでの問題は、Calibrationが失敗した後に、Rendererが何を表示し、どの状態へ留まり、再試行時に何を破棄するかが決められない点で別問題になる。

根拠:

- `SPEC.md:474`
- `SPEC.md:492`
- `SPEC.md:748-758`
- `SPEC.md:774`
- `SPEC.md:876-881`
- `HUMAN_TEST_GUIDE_JA.md:580`
- `MILESTONES.md:214`

実装影響:

- 低Hz、jitter過大、RightHand unavailable、session変更、sample不足などの失敗がすべて `failed` だけになり、初心者が画面を見ても次に何を直すべきか分からない。
- `failed` をError画面へ遷移させる実装、Calibration画面内の警告に留める実装、InputCheckへ戻す実装に分かれ、stateMachine testの期待値が固定できない。
- `calibrationQuality` は表示項目として要求されているが、失敗時payloadに直近quality snapshotがないため、失敗理由と品質表示が別々の推測実装になりやすい。
- session変更中の失敗と単なる手ぶれ失敗を区別できないと、旧sessionのCalibration失敗表示が新sessionのInputCheckやReadyへ残る可能性がある。

必要な解決:

- `CalibrationFailureCode` を定義する。例: `LOW_SAMPLE_RATE`、`UNSTABLE_NEUTRAL`、`INSUFFICIENT_FORWARD_DISTANCE`、`RIGHT_HAND_UNAVAILABLE`、`SESSION_CHANGED`、`TIMEOUT`。
- `CalibrationStatePayload` または別payloadに `failureCode`、`messageKey`、`source`、`sessionId`、`quality`、`sampleCount`、`occurredAtMs` を追加するか、失敗は必ず `AppErrorPayload` へ変換すると明記する。
- `state="failed"` の遷移先を固定する。例: Error画面ではなくCalibration画面に留まり、Enter/Spaceで再試行、RでTitleへ戻る。
- 低Hz、jitter過大、RightHand unavailable、session changeの失敗fixtureと手動確認手順を追加する。

---

### P1-72. `input:reset-filter` がsourceだけでsessionを識別できずstale resetを防げない

`input:reset-filter` のrequestは `{ source, reason }` だけで、`sessionId` や期待するbaseline identityを持たない。

既存P1-62は `app:error-clear` のsession scope、P1-68は `input:set-mode` の副作用順、P1-69は購読解除lifecycleを扱っている。ここではRendererからMainへ送るreset命令そのものが、どのsessionのfilterをresetする命令なのか識別できない点が別問題になる。

根拠:

- `SPEC.md:273-291`
- `SPEC.md:507`
- `SPEC.md:639-645`
- `SPEC.md:759-760`
- `SPEC.md:775`
- `UNRESOLVED_ISSUES_CURRENT.md:P1-62`
- `UNRESOLVED_ISSUES_CURRENT.md:P1-68`

実装影響:

- mode change、session change、Result replay、Error復帰の直後に古いRenderer handlerや遅延Promiseから `input:reset-filter` が届くと、Mainは現在sessionのfilterを誤ってresetする可能性がある。
- Main側で「旧session向けresetなので無視する」「source全体のmanual resetとして受ける」「active sourceだけ受ける」のどれが正か判断できず、P1-19のbaseline reset問題が再発する。
- Keyboard session更新後に旧keyboard session向けresetが届くと、Enter疑似sample列の初回速度/加速度や `droppedFrameCount` が不安定になる。
- testでは `sessionId` の違うreset命令を拒否するケースを作れず、UI再初期化やHMR由来のstale commandを検出しにくい。

必要な解決:

- `input:reset-filter` requestに `sessionId?: string | null` または `expectedSessionId` を追加する。
- `sessionId` 未指定、`null`、指定ありの意味を固定する。例: 指定ありは一致時のみreset、`null` はsource全体manual reset、未指定は互換用で禁止または `INVALID_REQUEST`。
- stale resetを受けた場合のresponse codeを固定する。例: `SESSION_STALE`、`MODE_UNAVAILABLE`、`INVALID_REQUEST` のどれにするか。
- `session-changed`、`input:set-mode`、`app:reset-play`、`calibration-start` の時系列fixtureに、旧session resetが現在sessionへ作用しないことを追加する。

---

### P2-18. READMEの参照順がAGENTSの判断順位と逆転している

READMEの「まず読むファイル」は `docs/requirements.md` の次に `AGENTS.md`、その後に `SPEC.md` を読む順序になっている。

一方、`AGENTS.md` 自体の最優先判断基準では `docs/requirements.md` または元要件定義書、`SPEC.md`、`AGENTS.md` の順で判断すると明記されている。既存P0-01/P0-02で `AGENTS.md` の責務・JSON・MotionSample契約が古いことも判明しているため、READMEの入口順は実装者に古いAGENTSをSPECより先に採用させるリスクがある。

根拠:

- `README.md:15-21`
- `AGENTS.md:5-11`
- `UNRESOLVED_ISSUES_CURRENT.md:P0-01`
- `UNRESOLVED_ISSUES_CURRENT.md:P0-02`
- `UNRESOLVED_ISSUES_CURRENT.md:P0-03`

実装影響:

- 新規作業者やCodexがREADMEだけを入口にすると、`SPEC.md` より先に古い `AGENTS.md` のRenderer責務や旧payload例を読み、Main/Renderer境界を誤って実装しやすい。
- 「判断基準」と「まず読むファイル」が別順序のため、レビュー時にどちらを正とするかで指摘が割れる。
- M0 blocker解消後の最小実装で、`MotionSample` 生成位置、preload API、UDP JSON validatorの初期型を間違える可能性がある。

必要な解決:

- READMEの「まず読むファイル」を `docs/requirements.md`、`SPEC.md`、`AGENTS.md`、`MILESTONES.md`、`HUMAN_TEST_GUIDE_JA.md` の順に直す。
- READMEに「実装契約は `SPEC.md` を正とし、`AGENTS.md` は作業規律。ただし衝突時はAGENTSの判断基準に従う」と明記する。
- P0-01/P0-02/P0-03が解消するまで、READMEに `AGENTS.md` / `docs/requirements.md` の一部が現行SPECと衝突していることを明示する。

---

## 追加未解決問題一覧（2026-06-06十五次検証追記）

以下は、十四次検証までの既存項目と重複しないように、仕様、マイルストーン、人間確認、AGENTS、検証報告を再照合して追加する懸念。運用・安全・配布周辺だけのものは除外し、実装順、Unity Bridge C#設定、VideoPlaybackの非同期状態、score調整用データ、IPC型名に直接影響するものに限定している。

### P1-73. M5の `motion:sample` IPCがM7のMotionSample生成より先に置かれている

`SPEC.md` では `motion:sample` のpayloadは完成形の `MotionSample` そのものであり、`velocity`、`acceleration`、`quality.dtMs`、`quality.flags` などを含む。

一方、`MILESTONES.md` ではM5-08で `motion:sample` IPCを作った後、M7-01以降で `motionSampleBuilder.ts`、dt、droppedFrameCount、EMA、速度、加速度、外れ値処理を実装する順序になっている。

既存P1-66はKeyboard経路のM2/M5順序を扱っているが、ここではUnity/Mock UDPからRendererへ送る `motion:sample` IPC自体が、完成形 `MotionSample` を生成できる前に完了扱いになり得る点が別問題になる。

根拠:

- `SPEC.md:461-482`
- `SPEC.md:679-687`
- `MILESTONES.md:165`
- `MILESTONES.md:190-201`

実装影響:

- M5-08を素直に実装すると、速度・加速度・filter・validityが仮値またはゼロ埋めの `MotionSample` をIPCへ流す可能性がある。
- M5のIPC testが「届くこと」だけで固定されると、M7後にpayload内容を変えた時にfixtureを作り直す必要が出る。
- Renderer側がM5時点の仮 `MotionSample` を前提にInputCheckやscoreの仮実装を進めると、M7以降にMain生成責務へ戻す手戻りが発生する。
- `motion:sample` の型は合っているが意味的に未完成、という状態をGate B2で見落としやすい。

必要な解決:

- M5-08より前、またはM5内に最小 `motionSampleBuilder` を前倒しし、少なくともdt、velocity、acceleration、`validForScore`、`validForCalibration`、flagsの初期契約を満たす。
- もしM5ではIPC導通だけを確認するなら、payloadを `TODO: TEMP_M5_SAMPLE_STUB` と明記し、Gate B2の完了条件から通常 `MotionSample` 完成を外さない。
- M5の `motion:sample` fixtureに、連続2〜3サンプルからdt/velocityが期待値になる確認を追加し、M7で同じfixtureを拡張する。

---

### P1-74. VideoPlaybackの非同期eventに現在playを識別する契約がない

状態遷移では `VideoPlayback --> Result` が動画終了で起き、`Esc`、`R`、Result再プレイ、Error復帰でVideoPlaybackから離脱できる。

しかし、HTML videoの `ended` / `error` / `stalled` / timeout handlerが、現在のプレイに属するeventか、すでにresetされた古いプレイのeventかを判定する `playId` / `runId` / `videoPlaybackId` 相当の契約がない。`app:reset-play` requestにも現在play identityは含まれていない。

既存P1-25はreset scope、P1-61はstateMachine event型、P1-69は購読解除lifecycleを扱っている。ここでは、解除やreset scopeを定義しても、遅れて届くvideo非同期eventを古いplayとして無視する識別子がない点が別問題になる。

根拠:

- `SPEC.md:754-760`
- `SPEC.md:803-808`
- `SPEC.md:826-837`
- `HUMAN_TEST_GUIDE_JA.md:268-284`
- `HUMAN_TEST_GUIDE_JA.md:308-322`

実装影響:

- Result再プレイ直後に前回videoの `ended` が遅れて発火すると、新しいプレイがまだInputCheck/Ready中でもResultへ飛ぶ実装になり得る。
- `Esc` でTitleへ戻った後に旧videoのdecode errorやtimeoutが発火し、Title上で `VIDEO_DECODE_FAILED` / `VIDEO_ENDED_TIMEOUT` が出る可能性がある。
- 10回連続Keyboard確認で、video eventの競合が低頻度にだけ出ると再現しづらい。
- videoManagerのunit/e2e testで、reset後の旧eventをno-opにするのかErrorにするのか期待値が固定できない。

必要な解決:

- 1プレイまたは1VideoPlaybackごとに `playId` / `videoPlaybackId` を発行し、`VIDEO_ENDED`、video error、timeout callback、Result生成に含める。
- stateMachineは現在の `playId` と一致しない `VIDEO_ENDED` / `VIDEO_ERROR` をno-opにする、と明記する。
- `app:reset-play`、Result replay、Esc、Error復帰時に現在play identityを更新し、旧videoのevent listener解除と併せてstale event fixtureを追加する。

---

### P1-75. Unity Bridge送信先IP・ポート・送信Hzの設定契約がSPEC/M9に落ちていない

`AGENTS.md` はC# / Unity実装規約として、送信先IP、ポート、送信HzをInspectorまたは設定値から変更できるようにすると定義している。

しかし `SPEC.md` は `127.0.0.1:45100` と標準送信頻度を示すだけで、Unity Bridge側のInspector field名、default値、許容範囲、保存方法、Electron側 `input.config.json` との関係を定義していない。M9のUnity Bridge実装タスクにも、送信先/送信Hzを設定可能にする作業が明示されていない。

既存P1-51は送信Hz制御と `seq` / `timestampMs` 発行基準を扱っているが、ここではC#実装でユーザーが変更できる送信先・port・target Hzの設定契約そのものが不足している点が別問題になる。

根拠:

- `AGENTS.md:283-289`
- `SPEC.md:231-244`
- `SPEC.md:250-260`
- `MILESTONES.md:221-229`
- `HUMAN_TEST_GUIDE_JA.md:440-443`
- `HUMAN_TEST_GUIDE_JA.md:472-488`

実装影響:

- `RightHandUdpSender.cs` に `127.0.0.1`、`45100`、`30Hz` が直書きされ、AGENTSの設定値を散らさない方針と衝突する。
- Unity側のTarget表示が、実際に送信している値なのか固定文言なのか分からなくなる。
- Electronの `input.config.json.udp.port` を変更してもUnity Bridge側が追従せず、InputCheckがNGになる原因を初心者が切り分けにくい。
- 送信Hzを50Hzへ上げる、または30Hzへ落とす調整がInspector値なのかコード変更なのか実装者ごとに分かれる。

必要な解決:

- `RightHandUdpSender` のInspector serialized fieldを定義する。例: `targetIp = "127.0.0.1"`、`targetPort = 45100`、`sendRateHz = 30`。
- 許容範囲を固定する。例: portは1〜65535、sendRateHzは1〜60または10〜60、IPは初期実装ではIPv4 literalのみ。
- BridgeStatusViewの `Target` と `Send Hz` は、この設定値と実測値を分けて表示すると明記する。
- Electron側 `input.config.json` とUnity側Inspector値が一致していることをGate B1/B2手順に追加する。

---

### P2-19. 実測調整に必要なraw score / peak値の出力契約がない

`SPEC.md` は `verticalRaw`、`forwardRaw`、`hakkeiRaw` を定義し、`MILESTONES.md` ではM11で `verticalRaw` / `forwardRaw` を成果物にし、M14でscore、発勁、動画しきい値を実測調整することになっている。

しかしResult用 `ScoreBreakdown` は正規化後の `verticalScore`、`forwardScore`、`hakkeiScore`、`power`、`damageYen`、`rank`、`videoLevel` だけを持ち、調整時に必要なraw積算値、Hakkei component peak、正規化前後の対応、採用windowの値をどこに残すかが定義されていない。

既存P1-34は `ScoreBreakdown` invariant、P1-49はHakkeiScore正規化順序、P2-08は損害額丸めを扱っている。ここでは、実測調整に必要な観測値をアプリ上またはログで取得する契約がない点が別問題になる。

根拠:

- `docs/requirements.md:157-159`
- `docs/requirements.md:957`
- `docs/requirements.md:1161`
- `SPEC.md:1032-1058`
- `SPEC.md:1114-1130`
- `MILESTONES.md:251-259`
- `MILESTONES.md:301-304`
- `HUMAN_TEST_GUIDE_JA.md:640-646`

実装影響:

- M14でしきい値を調整する際、軽い動きが高得点になる原因が `verticalRaw`、`forwardRaw`、velocity peak、acceleration peak、displacement peakのどれか判断しづらい。
- Resultに3スコアだけを出す実装では、RawMax調整やHakkei閾値調整の根拠を残せない。
- unit testではscore計算が合っていても、実機調整時に必要な中間値が見えず、設定変更が勘に寄る。
- Debug Fixtureやdiagnostic panelが独自にraw値を持つ実装と、scoreCalculator内部だけに閉じる実装に分かれる。

必要な解決:

- 通常Result用 `ScoreBreakdown` と別に、調整・診断用の `ScoreDiagnostics` または `ScoreDebugBreakdown` を定義する。
- 最低限、`verticalRaw`、`forwardRaw`、`hakkeiVelocityPeak`、`hakkeiAccelerationPeak`、`hakkeiDisplacement200ms`、component score、採用window時刻を持たせる。
- Human guideまたはverification checklistに、M14調整時はraw/peak値と変更後configをセットで記録する欄を追加する。
- 本番表示に出さない場合でも、diagnostic panelまたは安全なログで確認できるようにする。

---

### P2-20. `MotionSamplePayload` が検証報告にだけ存在し、SPECのIPC型と一致していない

`docs/archive/reviews/VALIDATION_REPORT.md` では、`SPEC.md` に `MotionSamplePayload` / `MotionHeartbeatPayload` / `MotionStatusPayload` / `AppErrorPayload` を追加したと記録されている。

しかし現行 `SPEC.md` の `RendererInboundEvents` では、`motion:sample` のpayloadは `MotionSample` そのものであり、`MotionSamplePayload` 型は定義されていない。heartbeat、status、errorは `*Payload` 型名を持つため、`motion:sample` だけ報告書と型名がずれている。

根拠:

- `docs/archive/reviews/VALIDATION_REPORT.md:12`
- `SPEC.md:679-687`

実装影響:

- 実装者が報告書の記述を見て `MotionSamplePayload` wrapperを作ると、preload APIとRenderer handlerの型が `MotionSample` 直渡し実装と食い違う。
- IPC fixture名やtest helper名が `MotionSamplePayload` と `MotionSample` に分かれる。
- `motion:sample` だけpayload wrapperを持たないのが意図なのか、単なる定義漏れなのかレビューで判断しづらい。

必要な解決:

- `motion:sample` は `MotionSample` 直渡しで固定するなら、`docs/archive/reviews/VALIDATION_REPORT.md` の記述を `MotionSample` に修正する。
- wrapperを採用するなら、`MotionSamplePayload` 型を `SPEC.md` に追加し、`RendererInboundEvents["motion:sample"]`、preload API、test fixtureを同じ型へ合わせる。

---

## 追加未解決問題一覧（2026-06-06十六次検証追記）

以下は、十五次検証までの既存項目に吸収されないか再確認したうえで追加する懸念。運用・安全・配布周辺だけのものは除外し、receiver状態更新順、Keyboard通常入力、videoManager実装、IPC reason型に直接影響するものに限定している。

### P1-76. session変更の確定がmotion/heartbeat固有検証より先で、不正packetでもsession resetが走り得る

`SPEC.md` は `sessionId` が変わったpacketをまずsession変更として扱うと書いている。またMain Process処理順とvalidator順序でも、共通field検証の後にsession変更判定を行い、その後でmotion schema / heartbeat schemaを検証する流れになっている。

この順序だと、`protocolVersion`、`type`、`source`、`sessionId` だけは正しいが、`seq` 欠損、`rightHand.x` 型不正、`frameRate` 不正などで最終的にinvalidになるpacketでも、先に `motion:session-changed`、filter baseline reset、Calibration破棄、`currentSessionId` 更新が発生し得る。

既存P1-65はUnity / Mock sender側の `sessionId` lifecycle、P1-44はmotion / heartbeat間のsession不一致を扱っている。ここでの問題は、Electron receiver側で「invalid packetがsession状態をcommitしてよいか」が未固定である点で別問題になる。

根拠:

- `SPEC.md:289`
- `SPEC.md:398-423`
- `SPEC.md:1269-1271`
- `SPEC.md:639-645`

実装影響:

- 欠損fieldを含む新session packetを1回受けただけで、RendererがCalibrationやscore baselineを破棄する実装になり得る。
- その直後に旧sessionの正常packetが来た場合、再度session変更として扱う実装と、rollback / mismatch扱いにする実装でテスト期待値が割れる。
- validator異常系fixtureが、invalid countだけを確認するはずなのに `motion:session-changed` や `app:error-clear` まで発火して、状態遷移testが不安定になる。
- Mock scriptの malformed packet がInputCheckやCalibration中の正常入力状態を壊し、初心者確認で原因を切り分けにくい。

必要な解決:

- session変更は「共通field検証後すぐcommit」ではなく、type固有schemaとrollback / gap判定のうち、どこまで通った時点でcommitするかを固定する。
- 推奨は、candidate sessionとして一時保持し、packetが受理可能と判定された時だけ `currentSessionId` 更新と `motion:session-changed` を発火する方式にする。
- invalid new-session packetを受けた場合は、invalid countと `app:error` / warningだけ更新し、filter、Calibration、source statusのcurrent sessionを変更しないと明記する。
- fixtureに「新sessionIdだがseq欠損」「新sessionIdだがrightHand型不正」「新sessionId heartbeat frameRate不正」を追加し、session状態が変わらないことを確認する。

---

### P1-77. Keyboard sample generatorのtick開始・停止・idle送信契約がない

`SPEC.md` はKeyboard入力もMainの `keyboardSampleGenerator` が疑似 `MotionSample` を生成すると定義し、Keyboard sample rateを60Hz、idle jitterを0mとしている。

しかし、Keyboard mode中にMainが60Hzで常時tickしてidle sampleも流すのか、keydown / keyupなど入力イベントが来た時だけsampleを出すのか、Title / InputCheck / Ready / charge中 / Resultでgeneratorを開始・停止する条件が明記されていない。

既存P1-42はKeyboard event識別子とpressed state失効、P1-50はSpace疑似波形、P1-66はM2/M5の実装順を扱っている。ここでの問題は、Keyboard sourceが通常入力sourceとして `motion:sample` をどの周期・状態で生成し続けるかが未定義な点で別問題になる。

根拠:

- `SPEC.md:434`
- `SPEC.md:507`
- `SPEC.md:511-519`
- `SPEC.md:1372`
- `MILESTONES.md:123-124`
- `MILESTONES.md:368`

実装影響:

- event-driven実装では、何も押していない間に `motion:sample.source="keyboard"` が流れず、statusの `isReceiving`、`motionHz`、`validSampleRatio`、dt表示が実装者ごとに変わる。
- 60Hz常時tick実装では、idle sampleを `validForScore=true` にするか、scoreには使わないsampleにするかで、Gate A/D2のfixture期待値が割れる。
- Enterの200ms疑似MotionSample列が、常時tickへ合成される実装と、Enter中だけ一時的にsample burstを出す実装で、Hakkei検出window、velocity、accelerationが変わる。
- mode change、Result replay、Error復帰後にgeneratorが止まらないと、非active Keyboard sampleが混入し、source排他やreset scope問題と組み合わさる。

必要な解決:

- Keyboard active中のgenerator lifecycleを固定する。例: `activeMode="keyboard"` かつInputCheck以降では60Hz tickを開始し、Titleへ戻る / mode変更 / app終了で停止する。
- idle sampleの扱いを固定する。例: idleでも `isAvailable=true` / `validForScore=true` だがdeltaが0なのでscoreは増えない、またはInputCheck用sampleとplay用sampleを分ける。
- key state更新、Space/A/D/Enter波形合成、seq/timestamp増分、first sample baseline化の順序を表にする。
- Keyboard fixtureに、無入力1秒、Space押下中、A/D交互、Enter burst、mode change後停止、Result replay後再開を追加する。

---

### P1-78. `videoLevels.file` からRendererで再生するURLへの解決契約がない

`ScoreConfig.videoLevels` は `file: string` だけを持ち、仕様上の動画配置は `assets/videos/*.mp4` として示されている。一方、videoManagerがRendererのHTML videoへ渡す値を、相対URL、app root相対URL、preloadで生成したURL、Main側で検査済みのfile URLのどれにするかは定義されていない。

Human guideも「videoタグの読み込みパス」を確認すると書いているが、標準の読み込みパスや不足ファイル名の生成元は固定されていない。ここでは配布時の同梱方法ではなく、開発中・通常実行中のvideoManager実装契約として問題になる。

既存P1-24は動画レベル境界、P2-03はvideo timeout、P1-59はRenderer発生Errorの通知経路、P2-09は音声assetを扱っている。ここでの問題は、Powerから選んだ `file` を実際にHTML videoへ渡すまでのURL解決と存在確認の責務が未定義な点で別問題になる。

根拠:

- `SPEC.md:170-177`
- `SPEC.md:723`
- `SPEC.md:1147-1152`
- `SPEC.md:1253`
- `SPEC.md:1351-1357`
- `MILESTONES.md:141`
- `HUMAN_TEST_GUIDE_JA.md:282-283`
- `HUMAN_TEST_GUIDE_JA.md:718`

実装影響:

- Rendererが `assets/videos/foo.mp4` を直接指定する実装、Main/preloadに存在確認させる実装、bundler importへ寄せる実装で、同じ `videoLevels.file` から異なるURLが生成される。
- `VIDEO_MISSING` の不足ファイル名を、config上のbasename、解決後URL、絶対パスのどれで表示するかが割れる。絶対パスを出すと `detailSafe` の制約とも衝突する。
- contextIsolationを守る場合、Renderer単体ではNodeの `fs` で存在確認できないため、動画欠落検出をvideoタグのerrorに任せるか、Main側で事前検査するかが実装者任せになる。
- Debug Fixtureの動画境界確認で、level選択は正しいのにURL解決だけが壊れるケースをunit testで切り分けにくい。

必要な解決:

- `videoLevels.file` はbasenameのみ許可し、標準baseを `assets/videos/` に固定するか、`AppConfig` に `videoAssetBasePath` / `videoAssetBaseUrl` を追加する。
- Rendererへ渡す前に `resolveVideoAsset(file)` の責務を定義する。例: Main/preloadで存在確認し、Rendererには再生用URLと表示用basenameだけを返す。
- `VIDEO_MISSING.detailSafe` は絶対パスではなく、level、basename、解決scopeだけを含めると固定する。
- videoManager fixtureに、正常basename、存在しないbasename、path traversal風文字列、空文字、拡張子違いを追加する。

---

### P2-21. `SessionChangedPayload.reason` が `app:reset-play` の理由を表しきれない

Keyboardは `app:reset-play` 実行時に `sessionId` と `seq` を更新すると定義されている。一方、`app:reset-play` のrequest reasonは `"replay" | "manual-reset" | "error-recovery"` だが、`SessionChangedPayload.reason` は `"source-start" | "session-id-changed" | "mode-change" | "manual-reset"` だけで、`replay` と `error-recovery` を表せない。

既存P1-25はreset scope、P1-65はUnity / Mock senderのsession lifecycle、P1-72はstale reset防止を扱っている。ここでの問題は、実際にsession変更eventとしてRendererへ戻るpayloadのreason unionが、reset命令のreason unionと対応していない点で別問題になる。

根拠:

- `SPEC.md:507`
- `SPEC.md:639-645`
- `SPEC.md:760`
- `SPEC.md:829`
- `HUMAN_TEST_GUIDE_JA.md:294-322`

実装影響:

- Result再プレイによるKeyboard session更新を `manual-reset` に潰す実装と、`session-id-changed` に寄せる実装で、Rendererのreset理由表示とtest期待値が割れる。
- Error復帰時のsession更新を通常replayと区別できないと、Error由来のwarning/error clear、Calibration破棄、diagnostic記録の理由が追えない。
- docs/runsや人間確認で「再プレイ」「手動リセット」「エラー復帰」のどれがsession更新原因だったかをpayloadから確認できない。

必要な解決:

- `SessionChangedPayload.reason` に `"replay"` と `"error-recovery"` を追加する。
- 追加しない場合は、`app:reset-play.reason` から `SessionChangedPayload.reason` へのmapping表を定義する。例: `replay -> manual-reset` とするなら、その理由と副作用差分なしを明記する。
- `app:reset-play` fixtureに、replay / manual-reset / error-recoveryそれぞれで発火する `motion:session-changed` reason、`app:error-clear` reason、reset scopeを追加する。

---

## 追加未解決問題一覧（2026-06-06十七次検証追記）

以下は、十六次検証までの既存項目と照合し、運用・安全・配布周辺だけのものを除外したうえで追加する懸念。unavailable sampleの中身、Calibration用validityのowner、heartbeat payloadの動的値、Unity Bridge v1 packet実装確認に直接影響するものに限定している。

### P1-79. `isAvailable=false` の `MotionSample` に入れる速度・加速度・raw値が未固定

`SPEC.md` は、`isTracked=false` または `avatar.hasRightHand=false` のmotionでもpacket自体が正しければ破棄せず、`isAvailable=false` の `MotionSample` を作るとしている。その際、`handPosition` は直前の有効filtered値を保持すると明記されている。

しかし `MotionSample` は `rawHandPosition`、`velocity`、`acceleration`、`quality.dtMs`、`quality.sampleRateHz`、`validForScore`、`validForCalibration` も必須であり、unavailable sample中にこれらへ何を入れるかが固定されていない。

既存P1-19は「復帰直後のbaseline reset」を扱っている。ここでの問題は、復帰前のunavailable sampleそのもののpayload内容が未定義な点で別問題になる。

根拠:

- `SPEC.md:348`
- `SPEC.md:461-482`
- `SPEC.md:487-492`
- `SPEC.md:1203-1213`

実装影響:

- `rawHandPosition` にpacketのrightHandを入れる実装、直前raw値を保持する実装、filtered値をコピーする実装でdiagnosticとInputCheckの表示が割れる。
- `velocity` / `acceleration` を0にする実装と直前値保持の実装で、Renderer側の表示、Hakkei diagnostic、fixture期待値が変わる。
- `quality.dtMs` と `sampleRateHz` を通常どおり進めるか、`DT_RESET` 相当にするかで、validSampleRatioやLOW_SAMPLE_RATE判定の分母が変わる。
- scoreは `validForScore=false` で守れるとしても、UIやdiagnosticに古い速度・加速度が「現在値」として残る可能性がある。

必要な解決:

- unavailable sample内容表を追加する。例: `rawHandPosition` は直前有効rawを保持、`handPosition` は直前有効filteredを保持、`velocity` / `acceleration` は0、`validForScore=false`、`validForCalibration=false`、flagsに原因を入れる。
- `dtMs`、`sampleRateHz`、`droppedFrameCount` を受信状態の測定として更新するのか、入力値として無効化するのかを分けて定義する。
- fixtureに `isTracked=false`、`avatar.hasRightHand=false`、復帰前後の3ケースを追加し、payload全fieldをassertする。

---

### P1-80. `validForCalibration` の算出に必要なCalibration phase同期契約がない

`MotionSample` はMain Processで生成され、Rendererは `validForCalibration` を再計算しない。一方、`validForCalibration` の説明には「Calibration中の最低Hzを満たす状態」とあり、これはCalibrationが開始済みか、どのsource/sessionを対象にしているか、何秒windowで最低Hzを見るかに依存する。

しかし `CalibrationStatePayload` は `calibrationId`、`state`、`occurredAtMs` だけで、対象source/session、capture phase、最低sample数、最低Hz、discard期間などをMainへ渡す契約になっていない。

既存P1-03はCalibration成功条件の粒度不足、P1-33はCalibration結果型と保持scopeを扱っている。ここでの問題は、Mainが各 `MotionSample` に入れる `validForCalibration` booleanをどの状態同期に基づいて生成するかが未固定である点で別問題になる。

根拠:

- `SPEC.md:434`
- `SPEC.md:461-474`
- `SPEC.md:492`
- `SPEC.md:748-758`
- `MILESTONES.md:209-216`

実装影響:

- MainがCalibration状態を知らずに `validForCalibration` を一般的な入力品質だけで付ける実装と、Rendererからの `calibration:set-state` に同期して付ける実装でfixture期待値が割れる。
- Calibration開始直後、source切替直後、session変更直後に、古いstate通知で新session sampleが `validForCalibration=true` になる可能性がある。
- Renderer側で不足情報を補って再判定すると、SPECの「Rendererは再計算しない」と衝突する。
- Keyboard疑似Calibration、Mock Unity Bridge Calibration、Unity Bridge Calibrationで同じsample列のvalidityが変わり、Gate C/D1の手動確認が再現しづらい。

必要な解決:

- `validForCalibration` をphase非依存の「Calibration候補sample」として再定義するか、Mainへ `CalibrationCaptureContext` を同期するかを決める。
- 同期する場合は、source、sessionId、calibrationId、phase、discardMs、minSampleRateHz、requiredWindowMs、開始/終了時刻をpayloadに含める。
- `calibration:set-state` 受信と `motion:sample` 生成が同時に起きる場合の順序、stale calibrationId/sessionIdの扱い、mode変更時の破棄条件をfixture化する。

---

### P2-22. `MotionHeartbeatPayload.ageMs` / `isAlive` の再発行契約がない

`MotionHeartbeatPayload` には `isAlive` と `ageMs` があるが、`motion:heartbeat` はheartbeat受信時にRendererへ届くpayloadとして定義されている。heartbeatが止まった後に新しい `motion:heartbeat` が発行されないなら、最後に届いたpayloadの `ageMs` と `isAlive` は古い値のままになる。

既存P1-41はtimeout表示に必要な `motion:status` 定期更新を扱っている。ここでの問題は、`motion:heartbeat` payload自体に動的なage/alive値が含まれているのに、その値を更新するイベント発行契約がない点で別問題になる。

根拠:

- `SPEC.md:599-610`
- `SPEC.md:681`
- `SPEC.md:780`
- `SPEC.md:1389`
- `SPEC.md:1469`

実装影響:

- Rendererが `onMotionHeartbeat` の最新payloadだけでheartbeat表示を作ると、timeout後も `isAlive=true` のまま残る。
- Rendererが `motion:status` からtimeoutを表示し、別UIが `motion:heartbeat` からaliveを表示すると、同じ画面内でalive/timeoutが矛盾し得る。
- heartbeat受信時だけ `ageMs=0` に近い値が届くなら、`ageMs` fieldは実質的に表示用として使えず、テストで何をassertすべきか不明になる。

必要な解決:

- `MotionHeartbeatPayload` から `ageMs` / `isAlive` を外し、動的なalive判定は `motion:status` のみで行うと明記する。
- もしくはMainがheartbeat未受信中も定期的に `motion:heartbeat` を再発行し、`ageMs` と `isAlive` を更新すると定義する。
- RendererのInputCheckは `motion:heartbeat` と `motion:status` のどちらを正にするかを固定し、timeout fixtureで両者が矛盾しないことを確認する。

---

### P2-23. M9のUnity Bridge実装タスクがv1共通fieldの送信確認まで落ちていない

`SPEC.md` では、motion / heartbeat共通で `protocolVersion`、`type`、`sessionId`、`timestampMs`、`source` を必須にしている。Gate B1でも、motion JSONとheartbeat JSONが `protocolVersion=1`、`sessionId`、`timestampMs` を含むことを要求している。

しかし `MILESTONES.md` のM9では、UDP送信、motion JSON、`seq`、heartbeat、rightHandReadyの確認が中心で、Unity Bridge側で `protocolVersion`、`source`、`sessionId`、`timestampMs` をmotion/heartbeat両方に入れることがタスク単位の確認方法として明示されていない。

既存P1-51はUnity Bridgeの送信Hz制御と `seq` / `timestampMs` 発行基準、P1-65は `sessionId` lifecycleを扱っている。ここでの問題は、M9の作業表だけを見て進めると、v1共通fieldを満たさないUnity Bridge送信実装でもM9完了に見えてしまう点で別問題になる。

根拠:

- `SPEC.md:265-291`
- `SPEC.md:293-389`
- `SPEC.md:1380`
- `MILESTONES.md:226-228`
- `HUMAN_TEST_GUIDE_JA.md:355-374`

実装影響:

- Unity Bridgeが `seq` とrightHandだけを送る古いmotion JSONでM9完了扱いになり、M5 validatorやGate B1/B2で後から全面修正になる。
- heartbeatだけ `sessionId` や `timestampMs` が欠ける実装でも、`rightHandReady` 表示だけを見て通過してしまう可能性がある。
- Mock senderはv1共通fieldあり、Unity Bridgeは旧形、という差が生まれると、実Unity入力だけ `INVALID_MOTION_PACKET` / `INVALID_HEARTBEAT_PACKET` になる。

必要な解決:

- M9に「motion / heartbeat両方へv1共通fieldを入れる」タスクを追加する。
- Unity Bridge診断またはElectron InputCheckで、`protocolVersion`、`source`、`sessionId`、`timestampMs`、`seq` の最新値を確認できるようにする。
- Unity Bridge sender確認fixtureまたは手動手順に、motionとheartbeatで同じsessionIdを共有し、timestampMsがsession内で単調増加することを追加する。

---

## 追加未解決問題一覧（2026-06-06十八次検証追記）

以下は、十七次検証までの既存項目と照合し、さらに5巡の独立サブエージェント検証で新規なしになるまで反復したうえで追加する懸念。運用・安全・配布周辺だけのものは除外し、実装、型、IPC、validator、状態遷移、Calibration、score、Gate技術判定、テスト契約に現実的な影響があるものに限定している。

### P1-81. Receiver状態がheartbeat / status契約に載っていない

Unity Bridge診断では `Receiver` のOK/NG表示が最低項目になっており、要件書でも `receiverActive` が診断ログ項目になっている。

しかし、標準heartbeat JSONと `MotionHeartbeatPayload` / `SourceStatusSnapshot` には `receiverActive` または `receiverReady` 相当のfieldがない。Electron側InputCheckやGate B/Dの判定も `rightHandReady`、Hz、座標中心で、Receiver Plugin自体が動いているかをpayloadから判断できない。

根拠:

- `SPEC.md:237`
- `docs/requirements.md:382`
- `SPEC.md:371-377`
- `SPEC.md:599-610`
- `SPEC.md:613-629`
- `MILESTONES.md:337`
- `HUMAN_TEST_GUIDE_JA.md:548`

実装影響:

- Unity Bridgeプロセス、Avatar、RightHand Transformは存在するが、mocopi Receiver Pluginが実際には受信していない状態をElectronで判別できない。
- staleなAvatar姿勢や静止座標でもInputCheckやGate B/DがOKに見える実装になり得る。
- Receiver停止時に `NOT_TRACKED`、`LOW_SAMPLE_RATE`、`UNITY_BRIDGE_TIMEOUT` のどれで表すかが実装者任せになる。

必要な解決:

- heartbeatに `receiverActive` / `receiverReady` を追加するか、Receiver状態はUnity Bridgeローカル診断専用でElectron契約に入れないと明記する。
- Electron契約に入れる場合は、`SourceStatusSnapshot`、InputCheck表示、warning/error条件、fixtureを更新する。
- 入れない場合は、Electron側Gateで「座標が実際に変化する」「motionHzがある」など、Receiver成立を別条件で判定する方針を固定する。

---

### P1-82. Mock Unity BridgeをactiveModeとして選ぶ導線がタスク化されていない

`SPEC.md` では `mock-unity-bridge` は通常score経路を通す正式なテスト用modeであり、`InputMode` にも含まれている。

一方、`MILESTONES.md` のTitle選択UIやInputCheck表示は `Keyboard / Unity Bridge` 中心で、Mock Unity Bridgeを選ぶUIまたはテスト専用導線がタスクとして落ちていない。

根拠:

- `SPEC.md:116`
- `SPEC.md:537`
- `MILESTONES.md:96`
- `MILESTONES.md:117`
- `MILESTONES.md:179`

実装影響:

- mock packetを仕様通り `source="mock-unity-bridge"` で送っても、activeModeをMockにできず非active source扱いになる。
- Mockの通常score経路、InputCheck、validator、Gate B2相当確認が実装者ごとに割れる。
- `SOURCE_MISMATCH` や `NON_ACTIVE_SOURCE_PACKET` の回避として、mock側sourceを `unity-bridge` に偽装する実装が生まれ得る。

必要な解決:

- Title、InputCheck、DiagnosticsのいずれかにMock Unity BridgeをactiveModeにする導線を追加する。
- UIに出さない方針なら、テスト専用の `input:set-mode { mode: "mock-unity-bridge" }` 導線と手動確認手順を明記する。
- Mock選択時にUnity Bridge modeとは別sourceとして扱うfixtureを追加する。

---

### P1-83. 通常 `mock:unity` がheartbeatを送る契約がM5 / checklistに落ちていない

`SPEC.md` ではUnity BridgeとMock Unity Bridgeのpacketは共通v1契約で、Gate B2はheartbeat受信と `motion:heartbeat` を要求している。Human guideもmockがmotion JSONとheartbeat JSONを送る確認になっている。

しかし `MILESTONES.md` のM5-02では、mock送信機の成果物が「motion JSONが送れる」に留まっており、通常 `mock:unity` がheartbeatも送ることが明示されていない。

根拠:

- `SPEC.md:265-277`
- `SPEC.md:352-389`
- `SPEC.md:1389`
- `HUMAN_TEST_GUIDE_JA.md:363`
- `MILESTONES.md:159`

実装影響:

- `npm run mock:unity` をmotion-onlyで実装してもM5-02完了扱いに読める。
- Human guideやGate B2で必要なheartbeat alive、`motion:heartbeat`、session共有の確認が後から不足する。
- Mock InputCheck、heartbeat timeout、motion/heartbeat session整合のfixture期待値が割れる。

必要な解決:

- 通常の `mock:unity` はmotionとheartbeatを同一 `sessionId` / `source="mock-unity-bridge"` で送る、とM5-02とchecklistへ明記する。
- motion-only確認が必要なら `mock:unity:motion-only` など別script名に分ける。
- mock heartbeat stallやsession mismatch確認は異常系scriptとして別扱いにする。

---

### P1-84. Mock Unity Bridgeの必須性がM5 / checklistとHuman guideで衝突している

Human guideでは、mock送信コマンドがない場合はLevel 2のMock確認を未実施でよいと読める。一方、M5では `npm run mock:unity` 作成が作業項目で、checklistでもMock受信とseq欠損確認が必須になっている。

根拠:

- `HUMAN_TEST_GUIDE_JA.md:353`
- `MILESTONES.md:159`
- `docs/verification_checklist.md:28-29`

実装影響:

- UDP validator、IPC、heartbeat確認をmock無しで完了扱いにできる。
- M5以降のfixture契約が、実装者によって「mock必須」と「mock任意」に割れる。
- 実Unity Bridgeが未完成の時に、validatorとstatusを再現可能に検証する手段がなくなる。

必要な解決:

- M5前はMock未実装でも `BLOCKED_M5_MOCK_SENDER` などで未実施扱い、M5完了以降は `mock:unity` 必須と明記する。
- checklistのMock項目に、未実装時の扱いとGate判定への影響を追加する。
- Human guideのLevel 2を「M5完了後は必須」に更新する。

---

### P1-85. Mock active時のwarning / error発火条件と文言がUnity専用のまま

Mock Unity Bridgeは正式なテスト用入力sourceだが、readiness系の `app:error` warning発火条件は `activeMode="unity-bridge"` の場合だけに読める。また、timeout固定文言は `Unity Bridge未接続` であり、Mock active時に同じ文言を出すか、別文言にするかが決まっていない。

根拠:

- `SPEC.md:116`
- `SPEC.md:537`
- `SPEC.md:389`
- `SPEC.md:1240`

実装影響:

- Mock active中の `avatarReady=false` / `rightHandReady=false` / heartbeat timeoutを `app:error` まで出す実装と、statusだけに留める実装に分かれる。
- MockでUnity相当のerror経路を自動テストできるかが不安定になる。
- Mock activeなのに `Unity Bridge未接続` をassertする手順になり、表示文言とsourceがずれる。

必要な解決:

- `unity-bridge` と `mock-unity-bridge` をまとめたbridge source扱いを定義し、readiness / timeout / low sample rateの適用範囲を固定する。
- Mockはstatus限定にするなら、その理由とGateで確認できる範囲を明記する。
- `messageJa` をsource別にするか、汎用文言へ変更するかを固定する。

---

### P1-86. 初回 / 未受信時の `MotionStatusPayload.sourceStatuses` 初期snapshotが未定義

`SourceStatusSnapshot` は全field必須で、`MotionStatusPayload.sourceStatuses` は全 `MotionSource` の `Record` 型になっている。InputCheckは未受信時にも受信OK/NG、最終受信時刻、Hz、invalid countを表示する前提で、M6にもstatus UIが個別タスク化されている。

しかし、起動直後、入力未選択、初回packet到着前に、全source keyを必ず入れるのか、active sourceだけ入れるのか、最初のpacketまでstatusを送らないのかが固定されていない。

根拠:

- `SPEC.md:613-637`
- `SPEC.md:1203-1213`
- `MILESTONES.md:179-187`

実装影響:

- Renderer初期描画、preload IPC test、InputCheckの初期fixtureで期待値を固定できない。
- `isReceiving`、`motionHz`、`heartbeatHz`、`invalidPacketCount` の初期値が実装者ごとに変わる。
- 未受信sourceのwarnings/errorsを空配列にするか、未定義にするかでstrict TypeScript実装が割れる。

必要な解決:

- Main起動後の最初の `motion:status` 発行タイミングと、全sourceの初期値表を定義する。
- 例: 全source keyを常に持ち、`isReceiving=false`、`currentSessionId=null`、`lastMotionAtMs=null`、`lastHeartbeatAtMs=null`、`motionHz=0`、`heartbeatHz=0`、`invalidPacketCount=0`、`warnings=[]`、`errors=[]`。
- `isReceiving` がheartbeatだけでtrueになるのか、valid motion必須なのかも同じ表で固定する。

---

### P1-87. Gate Bの定義がB1 / B2へ分割されず、RightHand不可でも通過可能に読める

`SPEC.md` ではGate B1がUnity側RightHand / v1共通field、Gate B2がElectron側UDP / validator / IPC / config確認に分かれている。一方、`MILESTONES.md` は単一のGate Bに潰しており、RightHandは「取得できる、または取得不可理由が特定されている」でも通過条件に読める。

根拠:

- `SPEC.md:1377-1390`
- `MILESTONES.md:329-337`
- `HUMAN_TEST_GUIDE_JA.md:548`

実装影響:

- Gate B1未達なのにGate B通過扱いになり得る。
- B2 validator / IPC未完了のままGate Cへ進む判定が起きる。
- RightHandが使えない状態を「診断済みPASS」と扱うと、Calibration、score、Gate C以降の前提が割れる。

必要な解決:

- `MILESTONES.md` もGate B1 / B2へ分ける。
- RightHand取得不可理由の特定は `BLOCKED_B1_RIGHT_HAND_UNAVAILABLE` などPASSとは別扱いにする。
- Gate B2はElectron receiver / validator / IPC / configをすべて満たす条件として独立記録する。

---

### P1-88. Gate D1の記録欄が必須条件を全て記録できない

Gate D1は `activeMode="unity-bridge"`、motionHz、heartbeatHz、timeoutなし、validSampleRatio、jitter、静止誤検出、実プレイ成立を必須にしている。

しかし `docs/verification_checklist.md` のGate D1技術判定メモは、jitter、validSampleRatio、静止誤検出中心で、motionHz、heartbeatHz、timeout有無、Unity実プレイ成立、動画 / Result到達を記録できない。

根拠:

- `SPEC.md:1400-1416`
- `MILESTONES.md:352-361`
- `docs/verification_checklist.md:48-62`

実装影響:

- 数値メモ上はPASSに見えても、実Unity入力で上下 / 前後 / 発勁 / 動画 / Resultが成立した証跡が残らない。
- D1の再現性が弱く、後続調整でどの条件を満たしたか追えない。
- timeoutなしやheartbeatHz不足が記録漏れになり得る。

必要な解決:

- D1メモに `activeMode`、motionHz、heartbeatHz、timeout有無、Unity実プレイ結果、動画 / Result到達を追加する。
- D1 PASS条件と記録欄を1対1にする。
- WARN / FAIL時にどの条件が原因かを記録できる欄を追加する。

---

### P1-89. Gate D2の判定記録欄がない

Gate D2はKeyboard fallback承認済みとして、Keyboard 10回連続完走、Keyboard由来 `MotionSample` が通常Hakkei判定と `calculatePowerFromScores()` を通ること、動画境界確認、Unity由来Error/warning clearを要求している。

しかし checklistにはGate D1技術判定メモしかなく、D2をD1とは別記録にする欄がない。

根拠:

- `SPEC.md:1418-1427`
- `MILESTONES.md:363-372`
- `docs/verification_checklist.md:48-62`
- `HUMAN_TEST_GUIDE_JA.md:815-823`

実装影響:

- Keyboard fallback承認をD1 PASSの代替として誤記録しやすい。
- 通常Hakkei判定、`calculatePowerFromScores()`、動画境界、`app:error-clear` の確認漏れが起きる。
- D2はD1の代替ではあるがD1通過ではない、という区別が記録に残らない。

必要な解決:

- checklistにGate D2専用欄を追加する。
- 10回完走、Keyboard由来 `MotionSample`、通常Hakkei判定、動画境界、`app:error-clear`、D1とは別記録であることを固定する。

---

### P1-90. 外れ値判定の処理段が速度・加速度計算順と噛み合っていない

filter pipelineでは `Outlier` が `Velocity` より前に置かれている。一方、設定値には `maxReasonableVelocity` と `maxReasonableAcceleration` があり、`MotionQualityFlag` には `OUTLIER_VELOCITY` / `OUTLIER_ACCELERATION` がある。

しかし、速度外れ値と加速度外れ値をraw差分、filtered velocity、smoothed velocity、clamp前後のどの値で判定するかが固定されていない。

根拠:

- `SPEC.md:911-930`
- `SPEC.md:939-941`
- `SPEC.md:455-457`
- `SPEC.md:491`

実装影響:

- `OUTLIER_VELOCITY` / `OUTLIER_ACCELERATION` の発火fixtureが実装ごとに変わる。
- `validForScore`、Hakkei検出、filter unit testの期待値が一致しない。
- clamp後の加速度をscoreに使うか、破棄するかの判断がP0-12だけでは決まらない。

必要な解決:

- position jump / velocity outlier / acceleration outlierの判定段をpipeline上で明示する。
- 各段の入力値、flag付与、clamp / 破棄順、`validForScore` への影響をfixture化する。

---

### P1-91. jitter計算に含めるsample条件とsample不足時の判定が未固定

静止jitterは2秒間のsampleからRMS、Max、driftを計算すると定義されている。一方、MotionSampleには unavailable、`validForScore=false`、`DT_RESET`、`OUTLIER_*` などの状態があり、どのsampleをjitter計算に含めるかがない。

根拠:

- `SPEC.md:348`
- `SPEC.md:461-482`
- `SPEC.md:961-990`
- `SPEC.md:665-677`

実装影響:

- unavailable時の保持 `handPosition` を含めるとfiltered jitterが過小評価される。
- outlierや `DT_RESET` を含めるとjitterが過大評価される。
- sample不足、Hz不足、unavailable混入時に `null`、WARN、FAILのどれにするかでGate D1とCalibration品質の判定が割れる。

必要な解決:

- raw / filtered jitterとdriftに含めるsample条件、除外flag、最低sample数、最低Hzを固定する。
- sample不足時のpayload値を `null` にするか、WARN / FAILにするかを明記する。
- 不足、unavailable、outlier混入fixtureを追加する。

---

### P1-92. filter初期化時の初回 `MotionSample` payloadが未定義

速度、加速度、EMAは前回位置、前回速度、前回filtered位置を必要とする。しかしsource開始、session変更、filter reset直後の初回valid sampleで、filtered位置、velocity、acceleration、dt、sampleRate、flags、validityに何を入れるかが固定されていない。

根拠:

- `SPEC.md:445-459`
- `SPEC.md:476-480`
- `SPEC.md:893-930`
- `SPEC.md:943-959`

実装影響:

- 初回filtered位置を0、初回raw、直前session値のどれにするかで、速度・加速度スパイクが発生し得る。
- Hakkei誤検出、M7の既知入力test、InputCheck表示、score baselineが揺れる。
- 既存P1-19はscore積算baselineを扱うが、filter state自体の初期payload値は固定していない。

必要な解決:

- 初回valid sampleではraw / filteredを現在値で初期化するかどうかを明記する。
- velocity、acceleration、`dtMs`、`sampleRateHz`、`DT_RESET`、`validForScore`、`validForCalibration` の値を表で固定する。
- source-start、session-change、manual reset、calibration-startのfixtureを追加する。

---

### P1-93. Unity側のreadiness / tracking真偽値の算出契約がない

motion JSONは `isTracked`、`avatar.isHuman`、`avatar.hasRightHand` を必須にし、heartbeat JSONは `avatarReady`、`rightHandReady` を必須にしている。Error固定表もこれらの真偽値に直結している。

しかしUnity Bridge側で、Receiver freshness、Animator状態、Humanoid Avatar妥当性、RightHand Transformの有無からこれらのbooleanをどう算出するかが定義されていない。

根拠:

- `SPEC.md:319-332`
- `SPEC.md:343-346`
- `SPEC.md:371-387`
- `SPEC.md:1241-1243`
- `docs/requirements.md:382-384`

実装影響:

- `RightHand Transform != null` だけで `isTracked=true` にすると、Receiver停止でアバターが最後の姿勢のまま固まっても有効sampleとしてscore / Calibrationに流れ得る。
- `NOT_TRACKED`、`AVATAR_NOT_READY`、`RIGHT_HAND_UNAVAILABLE` のfixture期待値が固定できない。
- motion側availabilityとheartbeat側readinessの矛盾が増える。

必要な解決:

- Unity Bridge側の算出表を追加する。
- 例: `receiverFreshWithinMs`、`animator != null`、`animator.avatar.isValid`、`animator.isHuman`、`GetBoneTransform(RightHand) != null` から各booleanをどう作るかを固定する。
- Receiver停止、Generic Rig、RightHand欠損、正常のfixtureまたは手動確認を追加する。

---

### P1-94. RightHand Transformの再取得・復帰契約がない

概念コードは `GetBoneTransform` 後に `rightHand.position` を読む形で、AGENTSではAnimatorとRightHand Transformのnullを初期化時と送信前に確認するとされている。

しかし、初回取得時だけnullだったRightHandが後から有効化された場合、またはAvatar差し替え / rebind後に古いTransformを持っている場合の再取得契約がない。

根拠:

- `SPEC.md:215-223`
- `AGENTS.md:286-290`
- `HUMAN_TEST_GUIDE_JA.md:448`

実装影響:

- Unity sceneやReceiver Pluginの初期化順によって、RightHandが後で有効化されても永続的に `rightHandReady=false` になる実装が生まれ得る。
- 逆に古いTransformを読み続け、実Avatarと送信座標がずれる可能性がある。
- RightHand NGからOKへの復帰手順とfixtureが固定できない。

必要な解決:

- `RightHandUdpSender` は初期化時だけでなく、Animator / Avatar / RightHandがnullまたは不一致の時に再解決すると明記する。
- 再解決成功時のheartbeat / motion readiness復帰タイミングを同一frame以降で固定する。
- 手動確認に「RightHand NGからOKへ復帰」を追加する。

---

### P1-95. `motion:session-changed` が同一sessionの全packetで発火するように読める

Main Process処理順の図では `Common -> Session -> IpcSession -> Type` が無条件edgeに見える。一方、Gate B2では `motion:session-changed` は「必要に応じて」とされている。

根拠:

- `SPEC.md:391-424`
- `SPEC.md:639-645`
- `SPEC.md:1389`

実装影響:

- 図どおり実装すると、`sessionId` が変わっていない通常のmotion / heartbeatでも毎回 `motion:session-changed` が出る。
- Rendererがこのeventでfilter、Calibration、score baseline、pressed stateなどをresetする実装だと、チャージが積算されない。
- InputCheck / Calibrationが点滅し、同一session連続packet fixtureが不安定になる。

必要な解決:

- `motion:session-changed` は `previousSessionId !== nextSessionId`、`source-start`、`mode-change`、`manual-reset` など、実際にsession状態が変わる場合だけ発火すると明記する。
- 同一 `source + remoteAddress + sessionId` の後続packetではsample / statusだけ更新し、session-changedは出さないfixtureを追加する。

---

### P1-96. `input:set-mode.reason` が下流payloadへ保存できない

`InputModeChangeRequest.reason` には `"user" | "fallback" | "test" | "mode-change" | "manual-reset"` がある。一方、`SessionChangedPayload.reason` と `AppErrorClearPayload.reason` には `user`、`fallback`、`test` がない。

根拠:

- `SPEC.md:639-645`
- `SPEC.md:658-663`
- `SPEC.md:739-742`
- `SPEC.md:1422-1425`

実装影響:

- Keyboard fallback、ユーザー手動選択、テスト用mode変更がすべて `mode-change` などに潰れる。
- `motion:session-changed` と `app:error-clear` のfixtureで理由をassertできない。
- fallbackで消したUnity warningと通常の手動mode変更をログ / diagnostic上で区別できない。

必要な解決:

- `input:set-mode.reason` から `SessionChangedPayload.reason` / `AppErrorClearPayload.reason` へのmapping表を固定する。
- もしくは両payloadのreason unionへ `user` / `fallback` / `test` を追加する。
- user / fallback / testの3経路で、activeMode変更、session変更、error clear reasonをassertするfixtureを追加する。

---

### P1-97. `dtMs` を秒へ変換する契約がない

`MotionSample.quality.dtMs` はms単位で、速度・加速度の式は `Δt` を使う。速度・加速度しきい値は `m/s`、`m/s²` で定義されているが、実装時に `dtSec = dtMs / 1000` を使うことが明記されていない。

根拠:

- `SPEC.md:476`
- `SPEC.md:897-905`
- `SPEC.md:940-941`
- `AGENTS.md:279`

実装影響:

- `dtMs` をそのまま割ると速度が1000分の1になり、加速度も大きくずれる。
- Hakkei検出、外れ値判定、Keyboard Enter fixture、score境界テストが破綻する。
- 単位名はあるが、数式fixtureがないためレビューで気づきにくい。

必要な解決:

- 速度・加速度計算は `dtSec = dtMs / 1000` を使うと明記する。
- `0.1m / 100ms = 1.0m/s`、速度差 `1.0m/s / 100ms = 10m/s²` のfixtureを追加する。

---

### P1-98. `MotionSample.quality.sampleRateHz` の算出定義がない

`MotionSample.quality.sampleRateHz` は必須で、`validForCalibration` の最低Hzにも関係する。一方、`SourceStatusSnapshot.motionHz` も別に存在する。

しかし `sampleRateHz` が瞬間値 `1000 / dtMs` なのか、window平均なのか、`timestampMs` / `receivedAtMs` のどちら由来かが固定されていない。

根拠:

- `SPEC.md:477`
- `SPEC.md:492`
- `SPEC.md:619`
- `SPEC.md:990`

実装影響:

- MotionSample builder、Calibration可否、diagnostics表示、LOW_SAMPLE_RATE周辺テストで期待値が割れる。
- 瞬間Hzならjitterに敏感になり、window平均なら初期 / 復帰直後の値が違う。
- `motionHz` と `sampleRateHz` の役割が混ざり、InputCheck表示が不安定になる。

必要な解決:

- `quality.sampleRateHz` はsample単体の瞬間Hz、`motionHz` はsource status用window平均、など役割を分ける。
- 算出clock、初回sample、unavailable、invalid、dt reset時の値をfixture化する。

---

### P1-99. `velocityEmaAlpha` の適用式と `MotionSample.velocity` の出力fieldが未固定

filter pipelineには `VelocitySmooth` があり、config例にも `velocityEmaAlpha` がある。しかし、明示式は位置EMAだけで、`MotionSample.velocity` がraw速度か平滑化後速度かが型からは分からない。

根拠:

- `SPEC.md:917-918`
- `SPEC.md:947-958`
- `SPEC.md:470`
- `SPEC.md:998-1001`

実装影響:

- Hakkeiの `forwardVelocity`、加速度計算、HakkeiScore peak、外れ値fixtureの期待値が実装ごとに変わる。
- raw velocityをHakkeiに使う実装と、filtered velocityを使う実装が分かれる。
- 加速度計算がraw velocity差分かfiltered velocity差分かで大きく変わる。

必要な解決:

- `velocityRaw` から `velocityFiltered` へのEMA式を定義する。
- `MotionSample.velocity` は平滑化後など、出力fieldの意味を固定する。
- raw速度が必要ならdiagnostic用fieldを別に持つ。

---

### P1-100. `UNKNOWN_FIELDS` の出力先が存在しないIPC pathとして書かれている

未知フィールド検出時に `motion:status.warnings` へ出すと書かれている箇所がある。しかし `MotionStatusPayload` にはtop-level `warnings` がなく、あるのは `activeWarnings` と `sourceStatuses[source].warnings` である。後段では `UNKNOWN_FIELDS` は `activeWarnings` と該当sourceの `warnings` に載せると書かれている。

根拠:

- `SPEC.md:350`
- `SPEC.md:631-637`
- `SPEC.md:690`

実装影響:

- 実装者がtop-level `warnings` を追加する実装と、現行型どおり `activeWarnings` / source別 `warnings` に載せる実装へ割れる。
- preload / Rendererの型一致テストとfixtureの期待pathがぶれる。

必要な解決:

- `SPEC.md:350` の参照を `motion:status.activeWarnings` と `motion:status.sourceStatuses[source].warnings` に統一する。
- top-level `warnings` を採用するなら、`MotionStatusPayload` 型へ明示追加する。

---

### P1-101. phase timer callbackに現在play / phase identityがない

Ready countdown、VerticalCharge / ForwardChargeの10秒経過、HakkeiReady timeout、ImpactDelayなどはtimerで進む。一方、R / Esc、Error recovery、Result replayでplayを離脱できる。

既存P1-74はVideoPlaybackの非同期event識別を扱っているが、phase timer全般の `playId` / `phaseId` / `timerId` 契約がない。

根拠:

- `SPEC.md:821-825`
- `SPEC.md:832-837`
- `SPEC.md:846-847`

実装影響:

- R、Esc、Error recovery、replay後に古い `setTimeout` / intervalが発火し、新しい状態またはreset済み状態を進める可能性がある。
- 同じphaseへ戻った時に古いtimerが現在playを進め、score / video / stateMachine fixtureが不安定になる。

必要な解決:

- 全timer eventに `playId`、`phaseId`、`phase` など現在play/phase identityを持たせる。
- reset / replay / Error recovery時は現在identityを無効化し、未処理timerをcancelする。
- stale timer eventはno-opになるfixtureを追加する。

---

### P1-102. プレイ中の入力劣化に対するstateMachine方針がない

要件書とHuman guideには、プレイ中に入力が1秒以上途切れる場合はKeyboardへ切り替える基準がある。一方、`SPEC.md` では `UNITY_BRIDGE_TIMEOUT` と `LOW_SAMPLE_RATE` はwarningで、VerticalCharge / ForwardCharge / HakkeiReady中の出口はtimer、発勁検出、reset中心である。

根拠:

- `docs/requirements.md:1243`
- `HUMAN_TEST_GUIDE_JA.md:833`
- `SPEC.md:803-805`
- `SPEC.md:1240`
- `SPEC.md:1244`

実装影響:

- VerticalCharge、ForwardCharge、HakkeiReady中に入力が途切れた時、タイマー継続、Error/InputCheck遷移、一時停止、自動Keyboard切替のどれにするかが割れる。
- score、reset scope、Gate C/D2 fallback挙動が実装者ごとに変わる。
- warningを出すだけでプレイを進める実装では、無効sample期間のscoreやHakkeiReady timeout扱いが不安定になる。

必要な解決:

- `INPUT_DEGRADED`、`FALLBACK_REQUESTED` などのeventと、状態別の挙動を定義する。
- 例: warningは自動で状態を進めない。操作担当者fallback時は現playを中断し、score/timer/sample baselineをresetしてKeyboard modeへ切替え、InputCheckへ戻る。
- active play中のtimeout / LOW_SAMPLE_RATE fixtureを追加する。

---

### P1-103. `keyboard:control` が対象Keyboard session / event順序を持たない

Keyboardはmode変更や `app:reset-play` で独立sessionとseqを更新する。しかし `KeyboardControlPayload` は `key`、`pressed`、`repeat` だけで、Keyboard session、epoch、event sequence、発生時刻を持たない。

根拠:

- `SPEC.md:507`
- `SPEC.md:744-746`
- `SPEC.md:773`
- `UNRESOLVED_ISSUES_CURRENT.md:1760-1787`

実装影響:

- replay直後、mode変更直後、Error復帰直後に旧keydown / keyupが遅れて届くと、新しいKeyboard sessionのpressed stateやEnter burstを誤って変更し得る。
- 10回連続Keyboard確認で、低頻度のscore跳ね、押下残り、意図しない発勁が出てもfixture化しにくい。
- 既存P1-42のkeyup欠落やpressed state失効だけでは、古いevent自体の識別を防げない。

必要な解決:

- `KeyboardControlPayload` に `keyboardSessionId` または `controlEpoch` と単調 `eventSeq` を追加する。
- Mainは現session / epoch不一致や古いseqをpressed-state更新前に拒否またはno-opにする。
- reset / replay / mode change後に旧keydown / keyupが遅れて届くfixtureを追加する。

---

### P1-104. Unity Bridgeの `LateUpdate` がReceiver Plugin反映後に走る保証がない

RightHand座標取得は、Receiver PluginがAvatarへ姿勢を反映した後の値を読みたいという理由で `LateUpdate` とされている。しかし、Receiver Plugin側も同じLateUpdate系で動く場合やScript Execution Orderが未固定の場合、`RightHandUdpSender` が前フレームのTransformを読む可能性がある。

根拠:

- `SPEC.md:223`
- `docs/requirements.md:372-374`
- `MILESTONES.md:225`

実装影響:

- 座標は動くためGate B / M9の単純確認を通り得るが、速度、加速度、発勁タイミングが1フレームずれる。
- 実機判定やHakkei fixtureが環境 / Unity実行順に依存する。

必要な解決:

- `RightHandUdpSender` はReceiver / Animator反映後に実行されることを仕様化する。
- 例: Script Execution Order / `DefaultExecutionOrder` で後段に固定する、または `WaitForEndOfFrame` 相当のpost-avatar phaseで読んで送る。
- M9 / M10に実行順設定レビューと、フレーム番号 / 送信時刻ログでstale readがないことを確認する手順を追加する。

---

### P1-105. preload APIの公開名と `Window` 型が未固定

`SPEC.md` は `contextBridge` で限定APIを公開するとし、`HakkeiPreloadApi` 型も定義している。しかし `contextBridge.exposeInMainWorld("...")` の公開キーと、Renderer側で使う `Window` ambient型が固定されていない。

根拠:

- `SPEC.md:765-789`
- `AGENTS.md:150-158`
- `SPEC.md:770-786`

実装影響:

- 実装者ごとに `window.hakkei`、`window.api`、`window.electronAPI` などへ分岐する。
- Renderer側が `(window as any)` に逃げやすくなり、strict TypeScript、preload unit test、Renderer integration testで期待API名を固定できない。
- `ipcRenderer` 非公開の検証対象も曖昧になる。

必要な解決:

- 公開名を1つに固定する。例: `contextBridge.exposeInMainWorld("hakkei", api)`。
- `declare global { interface Window { hakkei: HakkeiPreloadApi } }` などambient型を定義する。
- 公開キーに全メソッドがあり、`ipcRenderer` が露出しないpreload testを追加する。

---

### P1-106. `seq` 欠損の手動fixtureが弱く、count更新漏れをPASSできる

Human guideでは、`seq` 欠損packetについて「破棄される、または invalidPacketCount が増える」と読める確認になっている。しかし `SPEC.md` は不正packetを破棄し、破棄数を `sourceStatuses[source].invalidPacketCount` に加算すると定義し、Gate B2でも `seq` 欠損を `INVALID_MOTION_PACKET` としてinvalidにすることを条件にしている。

根拠:

- `HUMAN_TEST_GUIDE_JA.md:389-395`
- `SPEC.md:426`
- `SPEC.md:1248`
- `SPEC.md:1386`

実装影響:

- `seq` 欠損packetを単にMotionSample化しないだけで、`invalidPacketCount` や `INVALID_MOTION_PACKET` warning/status更新を実装していない受信処理でも手動確認を通せてしまう。
- validator unit testとHuman guideのPASS条件が一致しない。

必要な解決:

- 手順を「MotionSample化されない」「`INVALID_MOTION_PACKET` が出る」「該当sourceの `invalidPacketCount` が1増える」のAND条件にする。
- P2-14のcount scopeとは別に、このfixtureのPASS条件を強める。

---

### P2-24. `drift2s` がraw / filteredどちらの系列か未定義

jitterはrawとfilteredの両方を計算すると書かれており、payloadでもRMS / Maxはraw / filtered別fieldになっている。しかしdriftは単一の `drift2s` だけで、raw系列かfiltered系列かが定義されていない。

根拠:

- `SPEC.md:665-677`
- `SPEC.md:963-985`
- `docs/verification_checklist.md:55`

実装影響:

- raw driftでGate D1を判定する実装と、filtered driftで判定する実装に分かれる。
- 同じ静止ログのPASS / WARN / FAILが変わる。
- checklist上の `drift2s` が何を記録した値か分からなくなる。

必要な解決:

- `rawDrift2s` / `filteredDrift2s` に分けるか、Gate判定用はどちらか一方と明記する。
- payload、Gate D1表、checklistの項目名を揃える。

---

### P2-25. config変更の反映タイミングが未定義

`AppConfigBundle` は `loadedAtMs` を持つが、IPCは `config:get` だけでreload / watch系がない。一方、Gate D1では `input.config.json` のしきい値変更後に再測定するとされている。

根拠:

- `SPEC.md:726-737`
- `SPEC.md:754-762`
- `SPEC.md:1416`
- `MILESTONES.md:301-304`

実装影響:

- 起動時のみ読む実装、ファイル監視で即時反映する実装、手動reload IPCを作る実装に分かれる。
- Gate D1再測定、`loadedAtMs`、`CONFIG_INVALID` 発火、filter / score / video状態のreset scopeが揺れる。

必要な解決:

- config変更はアプリ再起動後に反映すると固定するか、`config:reload` IPCを定義する。
- reloadを採用するなら、失敗時の `CONFIG_INVALID`、反映成功時のscore/filter/video/reset scope、`loadedAtMs` 更新fixtureを追加する。

---

### P2-26. ResultのPower / 3スコア表示丸めが未定義

既存P2-08は `damageYen` の丸めと表示形式を扱っている。一方、ResultはPower、上下チャージスコア、前後チャージスコア、発勁スコア、ランク表示も必須だが、Powerや3スコアの小数桁、桁区切り、単位、内部値との分離が定義されていない。

根拠:

- `SPEC.md:1119-1127`
- `SPEC.md:1217-1228`
- `MILESTONES.md:276-277`
- `HUMAN_TEST_GUIDE_JA.md:292-296`

実装影響:

- Result UI testやDebug Fixture確認で `83`、`83.3`、`83.33`、`123456`、`123,456` など期待表示が割れる。
- 内部計算値と表示値を混同すると、ScoreBreakdown invariantや動画境界fixtureにも影響する。

必要な解決:

- `formatScoreBreakdown()` など表示専用ルールを固定する。
- 例: 3スコアは整数%または小数1桁、Powerは整数丸め+桁区切り、内部計算値とは別に表示値を扱う。
- Result presenter / Debug Fixtureの表示fixtureを追加する。

---

## 先に直すべき順序

1. 現リポジトリのM0 blockerを解消し、`package.json`、`tsconfig.json`、最小Electron起動、lint/test scriptを置く。
2. `README.md`、`AGENTS.md`、`docs/requirements.md`、`SPEC.md` の参照順、Main/Renderer責務、`MotionSample` 型を統一する。
3. `stateMachine` のevent / guard / side effect契約を型として固定し、Keyboard Enter既定値、Space疑似波形、Keyboard IPC前倒し、HakkeiReady timeoutの意味も同じ遷移表へ落とす。
4. Mock Unity Bridgeのactive modeとGate B2の扱いを統一する。
5. Config schemaとconfig例、M3 default値の扱い、`config:get` の失敗契約、`ScoreConfig` の数値整合条件を一致させる。
6. Calibration成功条件、失敗理由、表示/Error契約、破棄条件を実装可能な粒度で固定し、Main生成 `validForCalibration` とRenderer側Calibration phaseの同期方針も決める。
7. `forwardVector` に必要なUnity側データをUDP payloadへ追加するか、Electron側推定/config方式へ仕様を一本化し、座標補正後のvector正規化・直交条件も固定する。Unity Bridge単体確認とElectron Calibration後の前方向成分確認も切り分ける。
8. Unity Bridge送信Hz制御、v1共通field、`sessionId` lifecycle、`seq` / `timestampMs` 発行基準、Hz実測値の扱いを固定する。
9. IPC payload、preload購読口、preload購読解除lifecycle、response専用code、Renderer発生Error、`app:error-clear` のsession scope、heartbeat payloadの動的値、status/diagnostics、`staticFalseHakkeiCount10s` のowner、warning/errorの型穴を塞ぐ。
10. score/rank/video/debug fixtureの境界値、HakkeiScore正規化順序、Resultコメント契約を固定する。
11. reset / replay / R / Esc / `input:set-mode` / `input:reset-filter` の遷移先、IPC/control route、session scope、破棄範囲、プレイ中入力モード切替の許可状態を固定する。
12. `verticalNoiseThreshold`、動画level包含規則、損害額丸めなど、score表示の境界値をconfigとtestへ落とす。
13. timeout、cooldown、Ready / HakkeiReady / ImpactDelayのtimer値、および10秒静止誤検出の測定経路を資料間で統一する。
14. active / non-active source packetの扱い、Keyboard source status、motion/heartbeat session/readiness整合、`SOURCE_MISMATCH`、`NON_ACTIVE_SOURCE_PACKET`、`app:error-clear` の関係を固定する。
15. clock基準、`TIMESTAMP_GAP`、diagnostics window / 送信周期、Hz実測値など、時刻・window系payloadを実装可能な粒度へ落とす。
16. `app.config.json` 例、Calibration結果型、Keyboard疑似軸、ScoreBreakdown invariantを追加して、通常経路のfixture期待値を固定する。
17. InputCheckの表示view modelを定義し、座標/dtのsource/session/staleness、`InputMode="none"` の扱い、sessionId validatorの許容文字を固定する。
18. Gate A条件を資料間で統一し、10回連続Keyboard、Main生成 `motion:sample.source="keyboard"`、Power連動動画、ScoreBreakdown表示を必須化する。

## 現時点での結論

このままCodexに実装を依頼すると、実装不能ではないが、資料間の矛盾をCodexが推測で補う可能性が高い。特に `AGENTS.md` と `docs/requirements.md` は実装時に参照されやすいため、`SPEC.md` と衝突している部分を先に修正した方がよい。
