# docs/runs

`docs/verification_checklist.md` はテンプレートです。実際の確認記録は、このディレクトリに `YYYYMMDD-gate-a.md` のような名前で作成してください。



## 技術確認記録の必須項目

Gate記録では、運用・安全・配布ではなく、実装・テスト契約に関係する次を必ず残してください。

- activeMode、source、sessionId、lastSeq。
- motionHz、heartbeatHz、timeout有無。
- phase別validSampleRatio。
- `rawJitterRms2s`、`rawMaxJitter2s`、`rawDrift2s`、`filteredJitterRms2s`、`filteredMaxJitter2s`、`filteredDrift2s`。
- 10秒静止中の発勁誤検出回数。
- Gate B2/D1は実Unity Bridgeか、Gate D2はKeyboard fallbackか。
