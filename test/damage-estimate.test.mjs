// test/damage-estimate.test.mjs
// 損害見積書システム（2026-07-07）: アンカー補間・Σ=総額・minLevel フィルタ・決定性。
import test from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfigBundle } from "../src/main/appConfig.ts";
import {
  damageYenFromPower,
  buildDamageEstimate,
  buildCriticalEstimate,
} from "../src/renderer/damageEstimate.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const loaded = loadConfigBundle(join(root, "config"), 0);
if (!loaded.ok) throw new Error("config load failed: " + loaded.messageJa);
const SCORE = loaded.value.score;
const REPORT = SCORE.resultDamageReport;
const POWER = SCORE.power;

function sum(lines) {
  return lines.reduce((s, l) => s + l.yen, 0);
}

test("damageYenFromPower: power=0 は ¥0、単調増加、上端で頭打ち", () => {
  assert.equal(damageYenFromPower(0, POWER), 0);
  const p = [10000, 50000, 150000, 300000, 600000, 780000].map((x) => damageYenFromPower(x, POWER));
  for (let i = 1; i < p.length; i++) {
    assert.ok(p[i] > p[i - 1], `monotonic: ${p}`);
  }
  // 上端 power を超えても maxYen（±乱数分）で頭打ち＝爆発しない
  const top = damageYenFromPower(10_000_000, POWER);
  const maxYen = POWER.damageCurve.maxYen;
  assert.ok(top <= maxYen * (1 + POWER.damageVarianceRatio) + 1, `capped: ${top}`);
});

test("damageYenFromPower: 決定的（同じ power は毎回同じ額）", () => {
  assert.equal(damageYenFromPower(275000, POWER), damageYenFromPower(275000, POWER));
});

test("damageYenFromPower: Lv 帯のリアル較正（研究室1部屋・Lv2粉塵は低め/Lv5全損は数千万）", () => {
  const lv2 = damageYenFromPower(100000, POWER); // Lv2 帯（非線形カーブ・低め）
  const lv5 = damageYenFromPower(690000, POWER); // Lv5 帯 ≈¥2,800万（上限3,000万手前）
  assert.ok(lv2 < 1_000_000, `Lv2 は百万未満（粉塵）: ${lv2}`);
  // Lv5 は研究室1部屋の全損＋原状回復として数千万円に収める。
  assert.ok(lv5 > 10_000_000 && lv5 < 35_000_000, `Lv5 は数千万（億は付けない）: ${lv5}`);
});

test("buildDamageEstimate: Σ(行) = 総額（端数は調整行で吸収）", () => {
  for (const [total, level] of [[150000, 2], [1250000, 3], [4500000, 4], [18500000, 5]]) {
    const lines = buildDamageEstimate(total, level, "A", REPORT);
    assert.equal(sum(lines), total, `Σ must equal total (Lv${level})`);
    // 末尾は必ず調整行
    assert.equal(lines[lines.length - 1].kind, "reconcile");
  }
});

test("buildDamageEstimate: total<=0（Lv0）は空", () => {
  assert.deepEqual(buildDamageEstimate(0, 0, "D", REPORT), []);
});

test("buildDamageEstimate: minLevel フィルタ（低Lvで高Lv専用品は出ない）", () => {
  const lv2 = buildDamageEstimate(150000, 2, "B", REPORT);
  const labels = lv2.map((l) => l.label);
  // 構造復旧（minLevel5）や 5090 ハイエンド（minLevel4）は Lv2 見積書に出ない
  assert.ok(!labels.some((l) => l.includes("スラブ")), labels.join(","));
  assert.ok(!labels.some((l) => l.includes("5090")), labels.join(","));
});

test("buildDamageEstimate: 5桁級(ワークホース)品が複数壊れて主役になる（高額×1に埋もれない）", () => {
  const ceiling = REPORT.workhorsePriceCeiling;
  // Lv3/Lv4/Lv5 で、単価<=ceiling の品目が count>=2 の行として複数登場することを確認。
  for (const [total, level] of [[1300000, 3], [4500000, 4], [18000000, 5]]) {
    const lines = buildDamageEstimate(total, level, "A", REPORT);
    const workhorseItems = REPORT.items.filter((i) => i.unitPriceMax <= ceiling).map((i) => i.label);
    const multiWorkhorse = lines.filter((l) => {
      if (l.kind !== "item" || !workhorseItems.includes(l.label)) return false;
      const n = Number((l.qtyLabel.match(/(\d+)/) ?? [])[1]);
      return Number.isFinite(n) && n >= 2;
    });
    assert.ok(
      multiWorkhorse.length >= 2,
      `Lv${level}: 5桁級が複数壊れる行が2つ以上あるべき: ${lines.map((l) => l.qtyLabel + " " + l.label).join(" / ")}`,
    );
    assert.equal(sum(lines), total, `Σ=total (Lv${level})`);
  }
});

test("buildDamageEstimate: 行数は maxLinesByLevel 以内・決定的", () => {
  const lines = buildDamageEstimate(40000000, 4, "S", REPORT);
  assert.ok(lines.length <= REPORT.maxLinesByLevel[4], `lines=${lines.length}`);
  const again = buildDamageEstimate(40000000, 4, "S", REPORT);
  assert.deepEqual(lines, again);
});

test("buildCriticalEstimate: 大型電波塔bonusと研究室baseを別行で合計する", () => {
  const base = 20_000_000;
  const items = [{
    label: "大型電波塔",
    countLabel: "1基",
    bonusDamageYen: 65_000_000_000,
  }];
  const lines = buildCriticalEstimate(base, items, REPORT.criticalLabInclusiveLabel);
  assert.equal(sum(lines), 65_020_000_000);
  assert.deepEqual(lines[0], {
    label: "大型電波塔",
    qtyLabel: "1基",
    yen: 65_000_000_000,
    kind: "building",
  });
  assert.equal(lines.at(-1).label, REPORT.criticalLabInclusiveLabel);
  assert.equal(lines.at(-1).yen, base);
});
