// src/renderer/resultPresenter.ts
//
// Result HTML rendering from ScoreBreakdown.
// 損害額の大きな数字（合計）は result-focus 側で count-up 表示し、
// ここでは「研究室 破損見積書」＝品目×金額（Σ=合計）を組み立てて出す（2026-07-07 見積書システム）。

import type { ScoreBreakdown } from "../shared/types.ts";
import type { ScoreConfig } from "../shared/configTypes.ts";
import { buildDamageEstimate, type EstimateLine } from "./damageEstimate.ts";

const YEN = new Intl.NumberFormat("ja-JP");

function estimateLinesHtml(lines: EstimateLine[]): string {
  return lines
    .map((line) => {
      return `<li class="est-line est-${line.kind}"><span class="est-label">${escapeHtml(line.label)}</span><span class="est-qty">${escapeHtml(line.qtyLabel)}</span><strong class="est-yen">¥ ${formatDamageYen(line.yen)}</strong></li>`;
    })
    .join("");
}

function damageReportHtml(
  b: ScoreBreakdown,
  report: ScoreConfig["resultDamageReport"],
): string {
  const lines = buildDamageEstimate(b.damageYen, b.videoLevel, b.rank, report);

  if (lines.length === 0) {
    return "";
  }

  return `
    <section class="damage-report estimate" aria-label="Simulated lab damage estimate">
      <h3>SIMULATED LAB DAMAGE ESTIMATE</h3>
      <ul>${estimateLinesHtml(lines)}</ul>
    </section>`;
}

export function resultHtml(
  b: ScoreBreakdown | null,
  showDebugDetails: boolean,
  report: ScoreConfig["resultDamageReport"],
  highScoreHtml = "",
): string {
  if (!b) {
    return `<p class="hint">No score.</p>`;
  }

  const s = (n: number): string => n.toFixed(1);
  const outcome = b.hakkeiTimedOut
    ? "no-impact（timeout / Lv0）"
    : b.hakkeiDetected
      ? "発勁検出"
      : "-";

  const r = b.raw;
  return `
    <section class="result-focus" aria-label="リザルト">
      <div class="result-focus-label">TOTAL DAMAGE</div>
      <div class="result-focus-damage-wrap">
        <div id="result-damage-count" class="result-focus-damage" data-final-damage-yen="${b.damageYen}" data-final-damage-raw="${escapeAttr(String(b.damageYenText ?? b.damageYen))}" data-final-damage-text="${formatDamageYen(b.damageYenText ?? b.damageYen)}">
          <span class="result-damage-text">¥ 0</span>
        </div>
      </div>
      ${highScoreHtml}
      <div class="result-focus-rank rank-${b.rank}">Rank ${b.rank}</div>
    </section>
    ${damageReportHtml(b, report)}
    ${showDebugDetails ? `<table class="result result-detail result-debug-detail">
      <tr><th>Power</th><td>${Math.round(b.power).toLocaleString("ja-JP")}</td></tr>
      <tr><th>動画レベル</th><td>Lv${b.videoLevel}</td></tr>
      <tr><th>発勁</th><td>${outcome}</td></tr>
      <tr><th>スコア内訳</th><td>チャージ ${s(b.rightChargeScore)} / 発勁 ${s(b.hakkeiScore)}</td></tr>
      <tr><th>raw</th><td class="diag-hint">チャージ ${s(r.rightChargeRaw)}m / 発勁 v${s(r.hakkeiVelocityPeak)} a${s(r.hakkeiAccelerationPeak)} d${r.hakkeiDisplacement.toFixed(2)}m</td></tr>
    </table>` : ""}`;
}

function formatDamageYen(value: number | string): string {
  if (typeof value === "number") {
    return YEN.format(value);
  }
  if (!/^[0-9]+$/.test(value)) {
    return value;
  }
  const grouped = value.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return grouped;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}
