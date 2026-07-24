// src/renderer/punchCore.ts
//
// magnitude-only punch game coreの純粋ロジック（V3a）。
//   - accumulatePunchCharge: Charge フェーズで chargeRaw += chargeDelta（方向なし）。
//   - PunchDetector: HakkeiReady の accelEnergy ピークが閾値超でパンチ成立（magnitude のみ）。
//   - buildPunchScoreBreakdown: PunchScoreRawInput を既存 score pipeline へ橋渡しする短期 adapter。
//
// 方向/hidden/idle/両手同期は扱わない（§0.24）。score 計算自体は既存 §14 を流用し、
// 「right/left/forward」という旧概念を入口（PunchScoreRawInput）に漏らさない。
// 正規化の専用 config 化（charge/strength 専用レンジ）は V7 で行う。現状は既存レンジへ adapter する。

import type { PunchInputSample, PunchScoreRawInput } from "../shared/punchInput.ts";
import type { ScoreBreakdown } from "../shared/types.ts";
import type { ScoreConfig } from "../shared/configTypes.ts";
import { selectRank, selectVideoLevel } from "./scoreCalculator.ts";
import { damageYenFromPower } from "./damageEstimate.ts";

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

// Charge: 有効 sample の chargeDelta を積む（chargeDelta は adapter で noise 閾値済み・無効時 0）。
export function accumulatePunchCharge(chargeRaw: number, sample: PunchInputSample): number {
  if (!sample.validForScore) {
    return chargeRaw;
  }
  const d = sample.chargeDelta;
  return d > 0 ? chargeRaw + d : chargeRaw;
}

// HakkeiReady のパンチ検出（スパイク方式・2026-06-28 実機修正）。
// 旧実装は「閾値を最初に超えた瞬間」に発火し、その時点の低い値を威力にしていた
// （構えの腕引き ~159 deg/s で誤発火し本気パンチ ~1540 のピークを取り損ねた実機バグ）。
// 修正: start を超えたら inSpike にしてピークを追跡し、stop を下回った（=パンチが振り切って減衰した）
//   時点で **追跡した真のピーク** を strengthRaw として発火する。start は構え動作の上に置く。
export class PunchDetector {
  private static readonly MAX_SPIKE_HOLD_MS = 180;
  private startThreshold: number;
  private stopThreshold: number;
  private peak: number; // 現在のスパイクのピーク
  private inSpike: boolean;
  private maxPeak: number; // window 内で見た最大ピーク（timeout fallback / live 表示用）
  private spikeStartMs: number | null;

  constructor(startThreshold: number, stopThreshold: number) {
    this.startThreshold = startThreshold;
    this.stopThreshold = stopThreshold;
    this.peak = 0;
    this.inSpike = false;
    this.maxPeak = 0;
    this.spikeStartMs = null;
  }

  // 新しい HakkeiReady ウィンドウの開始時に呼ぶ（前回のスパイクを捨てる）。
  reset(): void {
    this.peak = 0;
    this.inSpike = false;
    this.maxPeak = 0;
    this.spikeStartMs = null;
  }

  // window 内で見た最大ピーク（live 表示・timeout 判定用）。
  currentPeak(): number {
    return Math.max(this.peak, this.maxPeak);
  }

  // 1 sample 観測。スパイク完了（立ち上がり→ピーク→減衰）で detected=true＋真のピークを返す。
  observe(sample: PunchInputSample): { detected: boolean; strengthRaw: number } {
    if (!sample.validForScore) {
      if (this.inSpike && this.peak >= this.startThreshold) {
        return this.finishSpike();
      }
      return { detected: false, strengthRaw: this.currentPeak() };
    }
    const v = sample.strength.intensity;
    if (!this.inSpike) {
      if (v > this.startThreshold) {
        this.inSpike = true;
        this.peak = v;
        this.spikeStartMs = sample.timestampMs;
      }
    } else {
      if (v > this.peak) {
        this.peak = v;
      }
      if (v < this.stopThreshold) {
        return this.finishSpike();
      }
      if (
        this.spikeStartMs !== null &&
        sample.timestampMs - this.spikeStartMs >= PunchDetector.MAX_SPIKE_HOLD_MS
      ) {
        return this.finishSpike();
      }
    }
    this.maxPeak = Math.max(this.maxPeak, this.peak);
    return { detected: false, strengthRaw: this.currentPeak() };
  }

  private finishSpike(): { detected: boolean; strengthRaw: number } {
    const p = this.peak;
    this.maxPeak = Math.max(this.maxPeak, p);
    this.inSpike = false;
    this.peak = 0;
    this.spikeStartMs = null;
    return { detected: true, strengthRaw: p };
  }
}

// 単手・magnitude-only専用の威力スコア（2026-06-27実機ウィザード計測で確定）。
// 旧 right×left×hakkei（単手だと charge² になる歪み）を廃止し、A=チャージ主役・B=パンチ従の式に置換。
//   power = powerK · detectGate · scoreGate^scoreGateGamma
//           · (noChargeBase + chargeWeight·A)^chargeGamma · (punchBase + punchWeight·B)
// detectGate=空振り足切り（0なら power 0）、scoreGate=「ゆっくり満タン」の高Lv化を塞ぐ第2ゲート。
//
// スコア用チャージ補正 A（2026-07-06 再設計）: UI表示%（線形・上限なし）とは分離し、
//   「割合 f = chargeRaw / 表示100%基準」を軸にした **ロジスティック飽和曲線** で作る。
//   A = 1/(1+exp(−(f − chargeScoreMid)/chargeScoreWidth))。過剰チャージで無限に強くならず(飽和)、
//   低チャージは強く抑制される。割合基準なので keyboard(基準10) と BLE(基準7500) が同一カーブを共有。
// chargeReadyOverride: source 別の「表示100%基準」(currentChargeReady)。未指定なら BLE 既定。
export function buildPunchScoreBreakdown(
  input: PunchScoreRawInput,
  cfg: ScoreConfig,
  chargeReadyOverride?: number,
): ScoreBreakdown {
  const p = cfg.punch;
  const ready = chargeReadyOverride ?? p.chargeReadyThreshold;
  const f = ready > 0 ? input.chargeRaw / ready : 0;
  const A = clamp01(1 / (1 + Math.exp(-(f - p.chargeScoreMid) / p.chargeScoreWidth)));
  const B = clamp01((input.punchStrengthRaw - p.punchMin) / (p.punchMax - p.punchMin));
  const detectGate = clamp01(
    (input.punchStrengthRaw - p.detectGateMin) / (p.detectGateFull - p.detectGateMin),
  );
  const scoreGate = clamp01(
    (input.punchStrengthRaw - p.scoreGateMin) / (p.scoreGateFull - p.scoreGateMin),
  );

  // no-impact（timeout）・未検出は power=0 / Lv0 に固定（既存契約）。
  const power =
    input.punchTimedOut || !input.punchDetected
      ? 0
      : p.powerK *
        detectGate *
        Math.pow(scoreGate, p.scoreGateGamma) *
        Math.pow(p.noChargeBase + p.chargeWeight * A, p.chargeGamma) *
        (p.punchBase + p.punchWeight * B);

  const damageYen = damageYenFromPower(power, cfg.power);
  return {
    // 表示用（Result「チャージ / 発勁」）。単手なので left は使わない。
    rightChargeScore: A * 100,
    leftChargeScore: 0,
    hakkeiScore: B * 100,
    hakkeiDetected: input.punchDetected && !input.punchTimedOut,
    hakkeiTimedOut: input.punchTimedOut,
    power,
    baseDamageYen: damageYen,
    damageYen,
    rank: selectRank(power, cfg),
    videoLevel: selectVideoLevel(power, cfg),
    raw: {
      rightChargeRaw: input.chargeRaw,
      leftChargeRaw: 0,
      hakkeiVelocityPeak: input.punchStrengthRaw,
      hakkeiAccelerationPeak: input.punchStrengthRaw,
      hakkeiDisplacement: input.punchStrengthRaw,
    },
  };
}
