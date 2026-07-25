import type {
  AppConfig,
  InputConfig,
  ResultDamageReportItemConfig,
  ScoreConfig,
} from "../shared/configTypes.ts";
import type { HakkeiPreloadApi } from "../shared/types.ts";
import { clearRankingBoard, loadRankingBoard } from "./rankingStore.ts";

type JsonObject = Record<string, unknown>;

type NumberField = {
  kind: "number";
  path: string[];
  label: string;
  unit: string;
  step: string;
  min?: number;
  note: string;
};

type SettingsSection = {
  id: string;
  title: string;
  description: string;
  fields: NumberField[];
};

const api = (window as unknown as { hakkei: HakkeiPreloadApi }).hakkei;
const root = document.getElementById("settings-app");

let scoreConfig: ScoreConfig | null = null;
let appConfig: AppConfig | null = null;
let inputConfig: InputConfig | null = null;
let dirty = false;
let statusText = "読み込み中";
let statusTone: "idle" | "ok" | "error" = "idle";

const sections: SettingsSection[] = [
  {
    id: "punch-score",
    title: "発勁スコア",
    description: "パンチ強度とタメ量の上限、足切り、最終Power係数を調整します。",
    fields: [
      {
        kind: "number",
        path: ["punch", "intensityThresholdBle"],
        label: "BLE 発勁検出しきい値",
        unit: "deg/s",
        step: "10",
        min: 0,
        note: "この値を超えるとパンチ候補としてピーク追跡を開始します。",
      },
      {
        kind: "number",
        path: ["punch", "punchReleaseRatio"],
        label: "発勁終了比率",
        unit: "ratio",
        step: "0.05",
        min: 0.01,
        note: "検出しきい値 × この比率を下回るとピークを確定します。",
      },
      {
        kind: "number",
        path: ["punch", "punchMin"],
        label: "発勁スコア 0% 強度",
        unit: "deg/s",
        step: "10",
        min: 0,
        note: "この強度以下は発勁スコアが0%です。",
      },
      {
        kind: "number",
        path: ["punch", "punchMax"],
        label: "全力パンチ基準（B=100%強度）",
        unit: "deg/s",
        step: "10",
        min: 1,
        note: "本気パンチのピーク角速度。ここでパンチスコアB=100%＝「全力」。実機で本気パンチのピークを測って合わせる（実測目安≈1540）。下げるほど本気で満点＝ゲージ100%でAに届きやすい／上げるほど辛い。",
      },
      {
        kind: "number",
        path: ["punch", "scoreGateFull"],
        label: "スコアゲート上限",
        unit: "deg/s",
        step: "10",
        min: 1,
        note: "強いパンチだけ高Lvにしたい場合は punchMax と合わせて上げます。",
      },
      {
        kind: "number",
        path: ["punch", "chargeReadyThreshold"],
        label: "表示100%の基準値",
        unit: "deg",
        step: "100",
        min: 1,
        note: "ゲージが100%になる chargeRaw。小さいほど早く満タン＝本気で振ると高%（例 7500 なら本気≈120%表示）。UI表示のみ・スコアはこの割合を基準に別曲線で計算。",
      },
      {
        kind: "number",
        path: ["punch", "chargeScoreMid"],
        label: "スコア中点（飽和位置）",
        unit: "×基準",
        step: "0.02",
        min: 0.05,
        note: "スコア用チャージが50%になる割合(表示%/100)。大きいほど高%まで伸びしろが残り、120%まで power が伸び続ける（飽和が遅い）。例 0.82。",
      },
      {
        kind: "number",
        path: ["punch", "chargeScoreWidth"],
        label: "曲線の効き（緩急）",
        unit: "",
        step: "0.01",
        min: 0.01,
        note: "小さいほど急峻（十分/不十分の境目が鋭い）。大きいほど緩やか＝オーバーチャージ域まで伸び続ける。例 0.26。",
      },
      {
        kind: "number",
        path: ["punch", "powerK"],
        label: "Power 全体係数",
        unit: "",
        step: "10000",
        min: 0,
        note: "Lvと損害額の全体スケールです。",
      },
      {
        kind: "number",
        path: ["power", "damageCurve", "deadZonePower"],
        label: "損害カーブ 無効域(power)",
        unit: "power",
        step: "1000",
        min: 0,
        note: "この power 以下は損害¥0（空振り域）。例 40000。",
      },
      {
        kind: "number",
        path: ["power", "damageCurve", "maxPower"],
        label: "損害カーブ 上限到達(power)",
        unit: "power",
        step: "1000",
        min: 1,
        note: "この power で損害が上限(maxYen)に達する。実効最大power(≈ゲージ150%全力)に合わせる。例 702000。",
      },
      {
        kind: "number",
        path: ["power", "damageCurve", "maxYen"],
        label: "損害カーブ 上限額",
        unit: "円",
        step: "1000000",
        min: 0,
        note: "損害総額の上限（頭打ち）。例 30000000（3,000万）。",
      },
      {
        kind: "number",
        path: ["power", "damageCurve", "gamma"],
        label: "損害カーブ 効き（γ）",
        unit: "",
        step: "0.1",
        min: 0.1,
        note: "1で線形。>1で加速的（中盤で一気に伸び、上限で頭打ち＝直線感が消える）。例 2.4。",
      },
      {
        kind: "number",
        path: ["power", "damageVarianceRatio"],
        label: "損害額ブレ幅",
        unit: "",
        step: "0.01",
        min: 0,
        note: "損害総額に乗る±乱数の割合。0.07で±7%（同じパンチは同じ額に固定）。",
      },
    ],
  },
];

const damageColumnHelp: Array<{ label: string; description: string; example: string }> = [
  {
    label: "品物",
    description: "見積書に出る品目名です。",
    example: "27インチ 4Kモニター交換費",
  },
  {
    label: "単位",
    description: "数量の後ろに付ける単位です。",
    example: "台 / 枚 / 脚 / 式 / 連",
  },
  {
    label: "単価下限",
    description: "この品目1個の再購入/復旧費の下限（円）。",
    example: "45000",
  },
  {
    label: "単価上限",
    description: "同上限。seedでこの範囲から1個単価を選びます。",
    example: "80000",
  },
  {
    label: "最低Lv",
    description: "この動画Lv以上でだけ見積書に載ります。低Lvで壊れていない物を出さないためです。",
    example: "2",
  },
  {
    label: "上限",
    description: "1見積書に載せる最大数量です。",
    example: "16",
  },
  {
    label: "出やすさ",
    description: "品目が選ばれる相対的な出やすさ（>0）。大きいほど載りやすい。",
    example: "1.2",
  },
];

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getAtPath(source: JsonObject, path: string[]): unknown {
  let current: unknown = source;
  for (const key of path) {
    if (!isObject(current)) {
      return undefined;
    }
    current = current[key];
  }
  return current;
}

function setAtPath(source: JsonObject, path: string[], value: unknown): void {
  let current: JsonObject = source;
  for (let i = 0; i < path.length - 1; i += 1) {
    const key = path[i];
    const next = current[key];
    if (!isObject(next)) {
      current[key] = {};
    }
    current = current[key] as JsonObject;
  }
  current[path[path.length - 1]] = value;
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function markDirty(): void {
  dirty = true;
  statusText = "未保存の変更があります";
  statusTone = "idle";
  renderStatus();
}

function render(): void {
  if (!root) {
    return;
  }
  root.innerHTML = `
    <main class="settings-shell">
      <header class="settings-header">
        <div>
          <p class="eyebrow">Hakkei Lab Breaker</p>
          <h1>設定</h1>
        </div>
        <div class="settings-actions">
          <button id="reload-button" type="button">再読み込み</button>
          <button id="save-button" class="primary" type="button"${dirty ? "" : " disabled"}>保存</button>
        </div>
      </header>
      <div id="settings-status" class="settings-status ${statusTone}">${escapeHtml(statusText)}</div>
      ${scoreConfig ? renderScoreSettings(scoreConfig) : `<section class="settings-panel">読み込み中...</section>`}
    </main>
  `;
  bind();
}

function renderScoreSettings(score: ScoreConfig): string {
  return `
    ${appConfig ? renderAudioSettings(appConfig) : ""}
    ${inputConfig ? renderInputCheckSettings(inputConfig) : ""}
    ${renderRankingResetSettings()}
    ${sections.map((section) => renderSection(score, section)).join("")}
    ${renderRankThresholds(score)}
    ${renderDamageReport(score.resultDamageReport.items)}
  `;
}

function renderInputCheckSettings(input: InputConfig): string {
  const policy = input.inputCheck.mocopiBleReadyPolicy;
  return `
    <section class="settings-panel">
      <div class="panel-heading">
        <h2>接続確認</h2>
        <p>InputCheckでmocopi BLEをready扱いにする条件を切り替えます。保存後、ゲーム再起動で反映されます。</p>
      </div>
      <div class="field-grid">
        <label class="field">
          <span class="field-label">mocopi ready判定</span>
          <span class="field-input-row">
            <select id="inputcheck-ready-policy">
              <option value="recent-only"${policy === "recent-only" ? " selected" : ""}>現在受信中だけready（安全）</option>
              <option value="sticky-after-first"${policy === "sticky-after-first" ? " selected" : ""}>一度受信したらready維持（旧仕様）</option>
            </select>
          </span>
          <span class="field-note">安全設定では未接続に戻るとPROCEEDが消えます。旧仕様は受信が一瞬途切れてもreadyを維持します。</span>
        </label>
        <label class="field">
          <span class="field-label">現在受信中とみなす時間</span>
          <span class="field-input-row">
            <input
              id="inputcheck-recent-window-ms"
              type="number"
              value="${escapeHtml(input.inputCheck.mocopiBleRecentWindowMs)}"
              min="250"
              max="5000"
              step="250"
            />
            <span class="unit">ms</span>
          </span>
          <span class="field-note">安全設定時の受信猶予です。ちらつく場合は1500〜2000ms程度に広げます。</span>
        </label>
      </div>
    </section>
  `;
}

function renderRankingResetSettings(): string {
  const board = loadRankingBoard(localStorage);
  return `
    <section class="settings-panel danger-panel">
      <div class="panel-heading">
        <h2>ランキング記録</h2>
        <p>このPCの登録済みユーザー、表示IDキャッシュ、High Score、プレイ履歴を削除します。</p>
      </div>
      <div class="reset-summary">
        <span>登録ユーザー: <strong>${board.players.length}</strong></span>
        <span>プレイ履歴: <strong>${board.records.length}</strong></span>
      </div>
      <button id="reset-ranking-button" class="danger" type="button">このPCのユーザー/ID/スコア記録をリセット</button>
    </section>
  `;
}

function renderAudioSettings(app: AppConfig): string {
  return `
    <section class="settings-panel">
      <div class="panel-heading">
        <h2>BGM音量</h2>
        <p>通常BGMの音量を調整します。保存後、ゲーム再起動で反映されます。</p>
      </div>
      <div class="field-grid">
        ${renderAudioVolumeField(
          "bgm.volume",
          "通常BGM",
          app.audio.bgm.volume,
          "公開版プレースホルダー。起動直後、通常プレイ、Lv5動画中に流れます。",
          3,
        )}
        ${renderAudioVolumeField(
          "chargeSound.volume",
          "チャージ音",
          app.audio.chargeSound.volume,
          "公開版プレースホルダー。ゲージが少しでも溜まってからLv動画開始まで流れます。",
          10,
        )}
        ${renderAudioVolumeField(
          "overchargeSound.volume",
          "オーバーチャージ音",
          app.audio.overchargeSound.volume,
          "公開版プレースホルダー。チャージゲージが100%を超えた瞬間から流れます。",
          10,
        )}
      </div>
    </section>
    <section class="settings-panel">
      <div class="panel-heading">
        <h2>Featured効果音（レア）</h2>
        <p>result_sfx/Featured の特別なプレースホルダー効果音の出現確率と音量。A/Sランクのリザルトで抽選されます。保存後、ゲーム再起動で反映されます。</p>
      </div>
      <div class="field-grid">
        ${renderFeaturedProbabilityField(app.audio.resultVoiceSfx.featuredProbability)}
        ${renderAudioVolumeField(
          "resultVoiceSfx.featuredVolume",
          "Featured効果音の音量",
          app.audio.resultVoiceSfx.featuredVolume,
          "Featuredプレースホルダー効果音の再生音量。",
          10,
        )}
      </div>
    </section>
    <section class="settings-panel">
      <div class="panel-heading">
        <h2>段階切り替えの効果音</h2>
        <p>待機→チャージ→構え→パンチの切り替わった瞬間に流れる合図音の音量。構え/パンチはチャージ100%以上だと専用のプレースホルダー音に変わります。保存後、ゲーム再起動で反映されます。</p>
      </div>
      <div class="field-grid">
        ${renderAudioVolumeField(
          "phaseCues.chargeStart.volume",
          "チャージ開始音（GO）",
          app.audio.phaseCues.chargeStart.volume,
          "公開版プレースホルダー。チャージに切り替わった瞬間。",
          10,
        )}
        ${renderAudioVolumeField(
          "phaseCues.stance.volume",
          "構え音（通常）",
          app.audio.phaseCues.stance.volume,
          "公開版プレースホルダー。構えに切り替わった瞬間（チャージ100%未満）。",
          10,
        )}
        ${renderAudioVolumeField(
          "phaseCues.stanceOvercharge.volume",
          "構え音（100%以上）",
          app.audio.phaseCues.stanceOvercharge.volume,
          "公開版プレースホルダー。構えに切り替わった瞬間（チャージ100%以上）。",
          10,
        )}
        ${renderAudioVolumeField(
          "phaseCues.punch.volume",
          "パンチ音（通常）",
          app.audio.phaseCues.punch.volume,
          "公開版プレースホルダー。パンチに切り替わった瞬間（チャージ100%未満）。",
          10,
        )}
        ${renderAudioVolumeField(
          "phaseCues.punchOvercharge.volume",
          "パンチ音（100%以上）",
          app.audio.phaseCues.punchOvercharge.volume,
          "公開版プレースホルダー。パンチに切り替わった瞬間（チャージ100%以上）。",
          10,
        )}
        ${renderAudioVolumeField(
          "phaseCues.stanceLeadSec",
          "構え音の先行秒（0-1s）",
          app.audio.phaseCues.stanceLeadSec,
          "構えに切り替わる何秒前に構え音を鳴らすか（例: 0.1 = 0.1秒前）。",
          1,
        )}
        ${renderAudioVolumeField(
          "phaseCues.punchLeadSec",
          "パンチ音の先行秒（0-1s）",
          app.audio.phaseCues.punchLeadSec,
          "パンチに切り替わる何秒前にパンチ音を鳴らすか（例: 0.1 = 0.1秒前）。",
          1,
        )}
      </div>
    </section>
  `;
}

function renderFeaturedProbabilityField(value: number): string {
  return `
    <label class="field">
      <span class="field-label">出現確率</span>
      <span class="field-input-row">
        <input
          type="number"
          data-app-number-path="audio.resultVoiceSfx.featuredProbability"
          value="${escapeHtml(value)}"
          min="0"
          max="1"
          step="0.05"
        />
        <span class="unit">0-1 (例: 0.2=1/5)</span>
      </span>
      <span class="field-note">A/Sランクのリザルトで、この確率でFeaturedボイスを1本抽選します（0=無効、1=必ず）。</span>
    </label>
  `;
}

function renderAudioVolumeField(path: string, label: string, value: number, note: string, max: number): string {
  return `
    <label class="field">
      <span class="field-label">${escapeHtml(label)}</span>
      <span class="field-input-row">
        <input
          type="number"
          data-app-number-path="audio.${path}"
          value="${escapeHtml(value)}"
          min="0"
          max="${max}"
          step="0.05"
        />
        <span class="unit">0-${max}</span>
      </span>
      <span class="field-note">${escapeHtml(note)}</span>
    </label>
  `;
}

function renderRankThresholds(score: ScoreConfig): string {
  const order: Array<{ rank: string; note: string }> = [
    { rank: "S", note: "S の土俵。ゲージ120%（全力パンチ）で到達する power。" },
    { rank: "A", note: "A の土俵。ゲージ100%（全力パンチ）で到達する power。" },
    { rank: "B", note: "B の下限 power（およそゲージ75%）。" },
    { rank: "C", note: "C の下限 power（およそゲージ50%）。" },
    { rank: "D", note: "D の下限 power（およそゲージ25%）。" },
    { rank: "E", note: "E の下限（通常 0）。空振り／ごく弱い一撃。" },
  ];
  const rows = order
    .map(({ rank, note }) => {
      const cur = score.rankThresholds.find((t) => t.rank === rank)?.minPower ?? 0;
      return `
        <label class="field">
          <span class="field-label">${rank} 下限 power</span>
          <span class="field-input-row">
            <input type="number" data-rank-threshold="${rank}" value="${escapeHtml(cur)}" min="0" step="1000" />
            <span class="unit">power</span>
          </span>
          <span class="field-note">${escapeHtml(note)}</span>
        </label>`;
    })
    .join("");
  return `
    <section class="settings-panel">
      <div class="panel-heading">
        <h2>ランク土俵（power しきい値）</h2>
        <p>ゲージ％＝到達できる天井、パンチ＝そこまで届かせる力。両方が要ります（例：ゲージ100%でも弱パンチなら B）。値は power の下限で、S≥A≥B≥C≥D≥E の順を保ってください。</p>
      </div>
      <div class="field-grid">${rows}</div>
    </section>
  `;
}

function renderSection(score: ScoreConfig, section: SettingsSection): string {
  const source = score as unknown as JsonObject;
  return `
    <section class="settings-panel" data-section="${section.id}">
      <div class="panel-heading">
        <h2>${escapeHtml(section.title)}</h2>
        <p>${escapeHtml(section.description)}</p>
      </div>
      <div class="field-grid">
        ${section.fields
          .map((field) => {
            const value = getAtPath(source, field.path);
            return `
              <label class="field">
                <span class="field-label">${escapeHtml(field.label)}</span>
                <span class="field-input-row">
                  <input
                    type="number"
                    data-number-path="${field.path.join(".")}"
                    value="${escapeHtml(typeof value === "number" ? value : "")}"
                    step="${field.step}"
                    ${field.min === undefined ? "" : `min="${field.min}"`}
                  />
                  ${field.unit ? `<span class="unit">${escapeHtml(field.unit)}</span>` : ""}
                </span>
                <span class="field-note">${escapeHtml(field.note)}</span>
              </label>
            `;
          })
          .join("")}
      </div>
    </section>
  `;
}

function renderDamageReport(items: ResultDamageReportItemConfig[]): string {
  return `
    <section class="settings-panel">
      <div class="panel-heading">
        <h2>破損見積書アイテム</h2>
        <p>Result の見積書に出る品目・単価レンジ・登場Lv・最大数量・出やすさを編集します。</p>
      </div>
      ${renderDamageHelp()}
      <div class="damage-table-wrap">
        <table class="damage-table">
          <thead>
            <tr>
              ${damageColumnHelp.map((column) => `<th title="${escapeHtml(column.description)}">${escapeHtml(column.label)}</th>`).join("")}
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${items.map((item, index) => renderDamageRow(item, index)).join("")}
          </tbody>
        </table>
      </div>
      <button id="add-damage-item" type="button">項目を追加</button>
    </section>
  `;
}

function renderDamageHelp(): string {
  return `
    <div class="damage-help">
      <div>
        <h3>見積書の作り方</h3>
        <p>損害総額（Lvアンカー補間で決定）を、最低Lvを満たす品目へ按分します。各品目は単価レンジから1個単価を選び、残予算に応じて数量を決めます。</p>
        <p>末尾は必ず「調整行（粉塵清掃／原状回復工事）」で端数を吸収し、Σ（品目合計）＝損害総額に一致させます。同じ結果は毎回同じ見積書になります。</p>
      </div>
      <div>
        <h3>入力例</h3>
        <p><b>27インチ 4Kモニター交換費</b> / 単位 <b>台</b> / 単価下限 <b>45000</b> / 単価上限 <b>80000</b> / 最低Lv <b>2</b> / 上限 <b>16</b> / 出やすさ <b>1.2</b></p>
      </div>
    </div>
    <div class="damage-help-grid">
      ${damageColumnHelp
        .map(
          (column) => `
            <div class="damage-help-card">
              <strong>${escapeHtml(column.label)}</strong>
              <span>${escapeHtml(column.description)}</span>
              <em>例: ${escapeHtml(column.example)}</em>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderDamageRow(item: ResultDamageReportItemConfig, index: number): string {
  const textCell = (key: keyof ResultDamageReportItemConfig, value: string): string => `
    <td><input type="text" data-damage-index="${index}" data-damage-key="${key}" value="${escapeHtml(value)}" /></td>
  `;
  const numberCell = (key: keyof ResultDamageReportItemConfig, value: number, step: string): string => `
    <td><input type="number" data-damage-index="${index}" data-damage-key="${key}" value="${escapeHtml(value)}" min="0" step="${step}" /></td>
  `;
  return `
    <tr>
      ${textCell("label", item.label)}
      ${textCell("unit", item.unit)}
      ${numberCell("unitPriceMin", item.unitPriceMin, "1000")}
      ${numberCell("unitPriceMax", item.unitPriceMax, "1000")}
      ${numberCell("minLevel", item.minLevel, "1")}
      ${numberCell("maxCount", item.maxCount, "1")}
      ${numberCell("weight", item.weight, "0.1")}
      <td><button type="button" data-delete-damage="${index}" aria-label="削除">削除</button></td>
    </tr>
  `;
}

function renderStatus(): void {
  const status = document.getElementById("settings-status");
  const save = document.getElementById("save-button") as HTMLButtonElement | null;
  if (status) {
    status.className = `settings-status ${statusTone}`;
    status.textContent = statusText;
  }
  if (save) {
    save.disabled = !dirty;
  }
}

function bind(): void {
  document.getElementById("reload-button")?.addEventListener("click", () => {
    void load();
  });
  document.getElementById("save-button")?.addEventListener("click", () => {
    void save();
  });
  document.getElementById("reset-ranking-button")?.addEventListener("click", () => {
    const ok = window.confirm("このPCの登録済みユーザー、表示IDキャッシュ、High Score、プレイ履歴をすべて削除します。元に戻せません。");
    if (!ok) {
      return;
    }
    clearRankingBoard(localStorage);
    statusText = "このPCのユーザー/ID/スコア記録をリセットしました";
    statusTone = "ok";
    render();
  });
  document.querySelectorAll<HTMLInputElement>("[data-number-path]").forEach((input) => {
    input.addEventListener("input", () => {
      if (!scoreConfig) return;
      const path = input.dataset.numberPath?.split(".") ?? [];
      setAtPath(scoreConfig as unknown as JsonObject, path, Number(input.value));
      markDirty();
    });
  });
  document.querySelectorAll<HTMLInputElement>("[data-app-number-path]").forEach((input) => {
    input.addEventListener("input", () => {
      if (!appConfig) return;
      const path = input.dataset.appNumberPath?.split(".") ?? [];
      setAtPath(appConfig as unknown as JsonObject, path, Number(input.value));
      markDirty();
    });
  });
  document.getElementById("inputcheck-ready-policy")?.addEventListener("change", (event) => {
    if (!inputConfig || !(event.currentTarget instanceof HTMLSelectElement)) return;
    const value = event.currentTarget.value;
    if (value === "recent-only" || value === "sticky-after-first") {
      inputConfig.inputCheck.mocopiBleReadyPolicy = value;
      markDirty();
    }
  });
  document.getElementById("inputcheck-recent-window-ms")?.addEventListener("input", (event) => {
    if (!inputConfig || !(event.currentTarget instanceof HTMLInputElement)) return;
    inputConfig.inputCheck.mocopiBleRecentWindowMs = Number(event.currentTarget.value);
    markDirty();
  });
  document.querySelectorAll<HTMLInputElement>("[data-damage-index]").forEach((input) => {
    input.addEventListener("input", () => updateDamageInput(input));
  });
  document.querySelectorAll<HTMLInputElement>("[data-rank-threshold]").forEach((input) => {
    input.addEventListener("input", () => {
      if (!scoreConfig) return;
      const rank = input.dataset.rankThreshold;
      const entry = scoreConfig.rankThresholds.find((t) => t.rank === rank);
      if (entry) {
        entry.minPower = Number(input.value);
        markDirty();
      }
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-delete-damage]").forEach((button) => {
    button.addEventListener("click", () => {
      if (!scoreConfig) return;
      const index = Number(button.dataset.deleteDamage);
      scoreConfig.resultDamageReport.items.splice(index, 1);
      markDirty();
      render();
    });
  });
  document.getElementById("add-damage-item")?.addEventListener("click", () => {
    if (!scoreConfig) return;
    scoreConfig.resultDamageReport.items.push({
      label: "新しい品物",
      unit: "個",
      unitPriceMin: 10000,
      unitPriceMax: 30000,
      minLevel: 2,
      maxCount: 10,
      weight: 1,
    });
    markDirty();
    render();
  });
}

function updateDamageInput(input: HTMLInputElement): void {
  if (!scoreConfig) return;
  const index = Number(input.dataset.damageIndex);
  const key = input.dataset.damageKey as keyof ResultDamageReportItemConfig | undefined;
  const item = scoreConfig.resultDamageReport.items[index];
  if (!item || !key) return;
  if (key === "label" || key === "unit") {
    item[key] = input.value;
  } else {
    item[key] = Number(input.value);
  }
  markDirty();
}

async function load(): Promise<void> {
  statusText = "読み込み中";
  statusTone = "idle";
  render();
  const result = await api.settingsGetConfig();
  if (result.ok) {
    appConfig = result.value.app as AppConfig;
    inputConfig = result.value.input as InputConfig;
    scoreConfig = result.value.score as ScoreConfig;
    dirty = false;
    statusText = "app.config.json / input.config.json / score.config.json を読み込みました";
    statusTone = "ok";
  } else {
    appConfig = null;
    inputConfig = null;
    scoreConfig = null;
    statusText = result.messageJa;
    statusTone = "error";
  }
  render();
}

async function save(): Promise<void> {
  if (!scoreConfig || !appConfig || !inputConfig) return;
  statusText = "保存中";
  statusTone = "idle";
  renderStatus();
  const result = await api.settingsSaveScore({
    app: appConfig,
    input: inputConfig,
    score: scoreConfig,
  });
  if (result.ok) {
    dirty = false;
    statusText = "保存しました。ゲーム側は再起動後に反映されます。";
    statusTone = "ok";
  } else {
    statusText = result.messageJa;
    statusTone = "error";
  }
  renderStatus();
}

void load();
