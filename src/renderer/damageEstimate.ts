// src/renderer/damageEstimate.ts
//
// 損害額と「研究室 破損見積書」の純粋ロジック（2026-07-07 見積書システム）。
//   - damageYenFromPower: power → 損害総額。Lv アンカー表の区分線形補間（非線形）＋seed 量子化の ±乱数。
//       旧「power × yenCoefficient」線形を置換。ランク/Lv はアンカー金額に内包（動画の破壊度で較正）。
//   - buildDamageEstimate: 損害総額を品目へ按分し、Σ=総額 になる見積書行を作る（末尾は調整行で端数吸収）。
//
// すべて決定的（seed=総額/Lv/ランク）＝同じ結果は毎回同じ見積書（リプレイ整合・video-keeper-workflow と別系）。

import type {
  ResultDamageReportItemConfig,
  ScoreConfig,
} from "../shared/configTypes.ts";

export type EstimateLineKind = "item" | "reconcile" | "building";

export type EstimateLine = {
  label: string;
  qtyLabel: string; // 例 "× 3 台" / "1式" / "1棟"
  yen: number;
  kind: EstimateLineKind;
};

// FNV-1a ベースの seed→[0,1)。文字列 seed から決定的な擬似乱数を得る（Math.random は使わない）。
function seededUnit(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// power → 損害総額（円）。非線形カーブ（加速→上限飽和）＋ seed 量子化の ±乱数。
//   base = maxYen · clamp01((power − deadZonePower)/(maxPower − deadZonePower))^gamma
// gamma>1 で中盤に一気に伸び、maxYen で頭打ち（「ずっと線形に増え続ける」違和感を排除）。
// 乱数は表示専用（rank/videoLevel は power から別途決まるので整合は崩れない）。
export function damageYenFromPower(power: number, cfg: ScoreConfig["power"]): number {
  const c = cfg.damageCurve;
  const span = c.maxPower - c.deadZonePower;
  const t = span > 0 ? clamp((power - c.deadZonePower) / span, 0, 1) : 0;
  const gamma = c.gamma > 0 ? c.gamma : 1;
  const base = c.maxYen * Math.pow(t, gamma);
  if (base <= 0) {
    return 0;
  }
  const ratio = cfg.damageVarianceRatio > 0 ? cfg.damageVarianceRatio : 0;
  // seed は power を丸めて量子化（同じパンチ＝同じ総額）。
  const u = seededUnit(`dmg:${Math.round(power)}`);
  const factor = 1 + (u * 2 - 1) * ratio;
  return Math.max(0, Math.round(base * factor));
}

// 単価レンジから seed で 1 個単価を選ぶ（100 円単位に丸めて見積書らしく）。
function seededUnitPrice(item: ResultDamageReportItemConfig, seed: string): number {
  const lo = Math.max(0, item.unitPriceMin);
  const hi = Math.max(lo, item.unitPriceMax);
  const u = seededUnit(`${seed}|u|${item.label}`);
  const raw = lo + (hi - lo) * u;
  const rounded = Math.round(raw / 100) * 100;
  return Math.max(100, rounded);
}

// ワークホース品（5桁級）の並び順：出やすさ(weight)優先＝現場で目立つ品を前に。
//   単価は使わない。実際に「たくさん壊れる」安〜中価格帯を先に置き、数量を稼がせる。
function seededOrderByWeight(
  items: ResultDamageReportItemConfig[],
  seed: string,
): ResultDamageReportItemConfig[] {
  return items
    .map((item) => {
      const w = item.weight > 0 ? item.weight : 0.0001;
      const jitter = 0.7 + seededUnit(`${seed}|ow|${item.label}`) * 0.6; // 0.7〜1.3
      return { item, key: w * jitter };
    })
    .sort((a, b) => b.key - a.key)
    .map((x) => x.item);
}

// 高額品の並び順：単価×weight 降順＝高い物を前に。残予算を少数行で吸収させる（調整行の肥大化防止）。
function seededOrderByPrice(
  items: ResultDamageReportItemConfig[],
  seed: string,
): ResultDamageReportItemConfig[] {
  return items
    .map((item) => {
      const w = item.weight > 0 ? item.weight : 0.0001;
      const jitter = 0.7 + seededUnit(`${seed}|op|${item.label}`) * 0.6; // 0.7〜1.3
      return { item, key: Math.max(1, item.unitPriceMax) * w * jitter };
    })
    .sort((a, b) => b.key - a.key)
    .map((x) => x.item);
}

// 損害総額 total を品目へ按分し、見積書行（Σ=total）を作る。
//   - level >= item.minLevel の品目だけ候補（低Lvで壊れていない物を出さない）。
//   - 末尾は必ず「調整行」で端数を吸収し、Σ を total に一致させる。
//   - total<=0（Lv0）は空。
export function buildDamageEstimate(
  total: number,
  level: number,
  rank: string,
  report: ScoreConfig["resultDamageReport"],
): EstimateLine[] {
  if (total <= 0) {
    return [];
  }
  const seed = `${level}:${rank}:${total}`;
  const candidates = report.items.filter((i) => level >= i.minLevel);
  const ceiling = report.workhorsePriceCeiling > 0 ? report.workhorsePriceCeiling : 120000;
  const workhorse = seededOrderByWeight(candidates.filter((i) => i.unitPriceMax <= ceiling), seed);
  const bigticket = seededOrderByPrice(candidates.filter((i) => i.unitPriceMax > ceiling), seed);

  const maxLines = report.maxLinesByLevel[level] ?? 4;
  const maxItems = Math.max(0, maxLines - 1); // 末尾の調整行ぶんを残す
  const reserveRatio = clamp(report.reserveRatio, 0, 0.9);
  const budget = Math.round(total * (1 - reserveRatio)); // 品目はここまで、残りは調整行へ

  // 行数配分: 高額品に bigLines を確保し、残りをワークホース品へ。
  const bigLines = Math.min(bigticket.length, report.bigTicketLinesByLevel[level] ?? 0, maxItems);
  const workhorseLines = Math.max(0, maxItems - bigLines);
  const wShare = clamp(report.workhorseBudgetShareByLevel[level] ?? 0.6, 0, 1);
  const workhorseBudget = Math.round(budget * wShare);

  const placements: Array<{ item: ResultDamageReportItemConfig; unit: number; count: number }> = [];
  let spent = 0;

  // Pass 1: ワークホース品（5桁級を多数）。workhorseBudget を等分し数量化。
  const wTarget = workhorseLines > 0 ? workhorseBudget / workhorseLines : 0;
  for (const item of workhorse) {
    if (placements.length >= workhorseLines) {
      break;
    }
    const unit = seededUnitPrice(item, seed);
    const remaining = budget - spent;
    if (remaining < unit) {
      continue; // 1 個も置けない
    }
    const jitter = 0.7 + seededUnit(`${seed}|f|${item.label}`) * 0.7; // 0.7〜1.4
    let count = clamp(Math.round((wTarget * jitter) / unit), 1, item.maxCount);
    if (count * unit > remaining) {
      count = Math.floor(remaining / unit);
    }
    if (count < 1) {
      continue;
    }
    placements.push({ item, unit, count });
    spent += count * unit;
  }

  // Pass 2: 高額品で残予算を吸収（少数行・高単価優先）。調整行だけが膨らむのを防ぐ。
  const bigBudget = Math.max(0, budget - spent);
  const bTarget = bigLines > 0 ? bigBudget / bigLines : 0;
  let bigPlaced = 0;
  for (const item of bigticket) {
    if (bigPlaced >= bigLines || placements.length >= maxItems) {
      break;
    }
    const unit = seededUnitPrice(item, seed);
    const remaining = budget - spent;
    if (remaining < unit) {
      continue;
    }
    const jitter = 0.7 + seededUnit(`${seed}|g|${item.label}`) * 0.7; // 0.7〜1.4
    let count = clamp(Math.round((bTarget * jitter) / unit), 1, item.maxCount);
    if (count * unit > remaining) {
      count = Math.floor(remaining / unit);
    }
    if (count < 1) {
      continue;
    }
    placements.push({ item, unit, count });
    spent += count * unit;
    bigPlaced += 1;
  }

  // top-up: 余り予算を既存行へ寄せ、調整行の肥大化を抑える。高単価行から埋める
  // （安物を過剰に盛らず、まず高額品で吸収 → それでも余ればワークホースを maxCount まで）。
  const topUpOrder = [...placements].sort((a, b) => b.unit - a.unit);
  let slack = budget - spent;
  let grew = true;
  while (slack > 0 && grew) {
    grew = false;
    for (const p of topUpOrder) {
      if (p.count < p.item.maxCount && p.unit <= slack) {
        p.count += 1;
        slack -= p.unit;
        spent += p.unit;
        grew = true;
      }
    }
  }

  const lines: EstimateLine[] = placements.map((p) => ({
    label: p.item.label,
    qtyLabel: `× ${p.count} ${p.item.unit}`,
    yen: p.count * p.unit,
    kind: "item",
  }));

  const reconcile = total - spent; // reserve により通常 >0。spent<=budget<=total なので常に >=0。
  const reconcileLabel =
    level >= report.reconcileHighLevel ? report.reconcileLabelHigh : report.reconcileLabel;
  lines.push({ label: reconcileLabel, qtyLabel: "1 set", yen: reconcile, kind: "reconcile" });
  return lines;
}
