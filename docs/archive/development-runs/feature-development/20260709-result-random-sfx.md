Result random SFX
- 対象ステップ: Result画面のランダム音声演出追加。
- 変更ファイル: `src/renderer/app.ts`, `src/renderer/resultSfxScheduler.ts`, `src/shared/configTypes.ts`, `src/main/appConfig.ts`, `config/app.config.json`, `scripts/build.mjs`, `test/config-loader.test.mjs`, `test/result-sfx-scheduler.test.mjs`, `HUMAN_TEST_GUIDE_JA.md`
- 採用した判断: `assets/Sound/SFX/result_sfx` の通常SFXはビルド時に `dist/renderer/sounds/result-sfx-manifest.json` へ列挙し、Result入場時に10個を重複なしでランダム選択する。各通常SFXは `baseDelayMs + index * staggerMs + random(jitterMs)` でずらし、5個目の通常SFXから `uniqueDelayMs` 後に `Unique_SFX` から1個だけ `uniqueVolume=0.5` で再生する。
- 理由・根拠: Rendererはブラウザ環境でローカルディレクトリ列挙ができないため、既存のassetsコピー処理にmanifest生成を追加するのが最小変更。Resultは再描画され得るため、状態入場検出で一度だけスケジュールし、Result離脱時はtimerを破棄する。音量・個数・ずらし幅は `app.config.json` に置き、現場で調整できるようにした。
- 確認結果: `npm run typecheck` / `npm test` / `npm run build` で確認する。
- 残課題: 実スピーカーでの音量バランス確認は人手。必要なら `config/app.config.json` の `audio.resultVoiceSfx.normalVolume` と `uniqueVolume` を調整する。

追記: ずらし幅調整
- 採用: `staggerMs=320`, `jitterMs=180`, `uniqueDelayMs=140`。
- 理由: 180ms刻みでは声が密に重なりすぎるため、10個の通常SFXが約3秒強に散る設定へ広げた。Uniqueは5個目の少し後に聞こえるよう、追従遅延も広げた。

追記: Rank別再生数
- 採用: Rank Eは再生なし、D=2、C=4、B=5、A=7、S=10。UniqueはSのみ、音量は `uniqueVolume=0.75`。
- 理由: 低ランクで声が多いと結果の重みづけと逆に聞こえるため、rankに比例して通常SFX数を増やす。Uniqueは最上位演出としてSに限定し、聞き取りやすさのため半分音量から3/4へ上げた。

追記: 間隔とCritical調整
- 採用: `staggerMs=460`, `jitterMs=240`, `uniqueDelayMs=200`。Rank Sは通常SFX 9個、Critical Resultは通常SFX 13個。
- 理由: 320ms刻みでも声が近いため、10個前後の音声が約4秒以上に散る設定へ広げた。Sは通常の最上位として少し抑え、Criticalは別格演出として13個に増やす。

追記: 音量調整
- 採用: `normalVolume=1.5`, `uniqueVolume=1.125`。
- 理由: Result SFX全体を約1.5倍にしつつ、Uniqueは通常の3/4程度という比率を維持する。

追記: 音量2倍・Critical全件再生
- 採用: `normalVolume=2`, `uniqueVolume=1.5`。Critical Resultではmanifest上の通常SFXを全件再生し、Uniqueは `delayMs=0` でResult表示直後に再生する。
- 理由: 通常音量を元比2倍まで上げ、Criticalは最上位演出として件数上限を外す。UniqueはCritical時の強い出だしとして、5個目付近ではなく画面入場直後に固定する。

追記: Critical動画開始時再生・音量さらに2倍
- 採用: `normalVolume=4`, `uniqueVolume=3`。Critical時のResult SFXはResult画面入場ではなくCritical動画の再生開始時にスケジュールする。Uniqueは引き続き1個のみで、Critical動画開始直後に鳴らす。
- 理由: Critical動画の迫力に合わせて音声演出を同期させるため。通常SFX全件は動画からResultへまたがる可能性があるため、Result描画時のtimer一括破棄対象から外し、replay/reset時に停止する。

追記: Critical Uniqueタイミング再調整
- 採用: Critical動画中はUniqueなしで通常SFX全件だけを流す。Result入場時に動画中SFXの残timerを止め、通常SFX 13個とUnique 1個を新規に開始する。音量は `normalVolume=3`, `uniqueVolume=2.25`。
- 理由: UniqueはResult画面開始の合図として1回だけ鳴らす方が演出意図に合うため。動画中の通常SFXはResult直前までの盛り上げに留め、Result入場後の13個と混ざりすぎないようtimerを切り替える。
