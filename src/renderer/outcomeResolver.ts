// src/renderer/outcomeResolver.ts
//
// 単手モデルのトリガー解決とアウトカム解決（§0.23.5/0.23.6/0.23.7・M15-01）。
//
// 設計原則（2026-06-25確定）:
//   - 純粋関数。stateMachine/DOM に依存しない（単体テスト可能）。
//   - score 計算とは分離。resolveTrigger は「どの方向/結果か」だけを決め、
//     resolveOutcome は trigger と config から「動画と表示可否」を決める。score は混ぜない。
//   - idle は時間ベース（HakkeiReady 滞在）の判定で、ここでは扱わない（state 側で決め trigger="idle" を渡す）。
//     special_* も Phase B（M16）。resolveTrigger が返すのは forward/down/up/back/hiddenMiss/noImpact。

import {
  leftHandKinematics,
  rightHandKinematics,
  type HakkeiHandKinematics,
} from "./hakkeiDetector.ts";
import type { ScoreConfig } from "../shared/configTypes.ts";
import type {
  DominantHand,
  MotionSample,
  Outcome,
  OutcomeTrigger,
  ScoreBreakdown,
  Vec3,
  VideoSelection,
} from "../shared/types.ts";

// 利き手の hand kinematics を選ぶ（§0.23.2）。右手＝トップレベル、左手＝leftHand。
// 左手が無い v1/unavailable sample で "left" 指定なら null（呼び出し側で待機/unavailable 扱い）。
export function handKinematicsFor(
  sample: MotionSample,
  dominantHand: DominantHand,
): HakkeiHandKinematics | null {
  return dominantHand === "left" ? leftHandKinematics(sample) : rightHandKinematics(sample);
}

export type TriggerThresholds = Pick<
  ScoreConfig["hakkei"],
  "forwardCos" | "dirCos" | "hiddenForwardLeakMax"
> & {
  hiddenChargeGate: number;
};

export type ResolveTriggerInput = {
  // 前後の強さ条件（高い閾値）。forward/back に使う。
  forwardStrengthMet: boolean;
  // 上下の強さ条件（低い閾値＝hiddenStrengthScale 倍）。踏み込みで勢いが乗りにくい up/down 用。
  hiddenStrengthMet: boolean;
  // 突きの方向ベクトルとしてpeakVelocityDir ?? netDeltaを渡す。
  directionVector: Vec3;
  charge: number; // 利き手チャージ量（Σ|Δp|）
  forwardVector: Vec3; // Calibration の前方向
  upVector: Vec3; // Calibration の上方向
};

// 方向の内訳（水平 forward 基準の前/後・重力 up 基準の上/下）。診断表示と resolveTrigger で共用。
// dir 正規化不能 or 軸 degenerate なら null。
export type DirectionComponents = {
  dir: Vec3; // 正規化した方向ベクトル
  dotForward: number; // dot(dir, 水平forward)
  dotBack: number; // dot(dir, -水平forward)
  dotUp: number; // dot(dir, up)
  dotDown: number; // dot(dir, -up)
};

export function directionComponents(
  directionVector: Vec3,
  forwardVector: Vec3,
  upVector: Vec3,
): DirectionComponents | null {
  const dir = normalizeOrZero(directionVector);
  const up = normalizeOrZero(upVector);
  const forward = normalizeOrZero(forwardVector);
  if (dir === null || up === null || forward === null) {
    return null;
  }
  // forward/back は up 成分を抜いた水平 forward で判定（facing 内の前後・腕の弧で汚れにくい）。
  const forwardH = normalizeOrZero(sub(forward, scale(up, dot(forward, up)))) ?? forward;
  return {
    dir,
    dotForward: dot(dir, forwardH),
    dotBack: dot(dir, neg(forwardH)),
    dotUp: dot(dir, up),
    dotDown: dot(dir, neg(up)),
  };
}

// §0.23.6の順序でトリガーを解決し、forwardを優先する。
// idle/special_* は対象外（state 側）。
//
//   1. 方向正規化不能 → noImpact
//   2. **前方を最優先**（forwardStrengthMet ∧ dot(dir, forwardH) ≥ forwardCos）→ forward
//   3. up/down は **hiddenStrengthMet**（低い強さ閾値）∧「前方成分が小さい」∧ dirCos ∧ gate → down/up
//      back も hiddenStrengthMet ∧ dot(dir, -forwardH) ≥ dirCos ∧ gate（Phase A 暫定・厳密振り向きは Phase B）
//   4. hidden 方向は明確だが gate 不足 → hiddenMiss（通常破壊にしない）
//   5. それ以外 → noImpact
//
// 実機確認で固定した設計要点:
//   - forward を hidden より先に判定（hiddenChargeGate=0 でも forward を奪わせない）。
//   - up/down は重力基準 up、forward/back は **up 成分を抜いた水平 forward** で見る（腕の弧の縦漏れ対策）。
//   - 前後は踏み込みで勢いが乗るが上下は乗りにくいため、**up/down は低い強さ閾値**で判定（hiddenStrengthMet）。
export function resolveTrigger(
  input: ResolveTriggerInput,
  thresholds: TriggerThresholds,
): OutcomeTrigger {
  const c = directionComponents(input.directionVector, input.forwardVector, input.upVector);
  if (c === null) {
    return "noImpact";
  }
  const { dotForward, dotBack, dotUp, dotDown } = c;

  // 1. 前方を最優先（前後の高い強さ閾値）。
  if (input.forwardStrengthMet && dotForward >= thresholds.forwardCos) {
    return "forward";
  }

  // 2/3. hidden（up/down/back）は低い強さ閾値（hiddenStrengthMet）。
  if (input.hiddenStrengthMet) {
    const gateOk = input.charge >= thresholds.hiddenChargeGate;
    const verticalOk = Math.abs(dotForward) <= thresholds.hiddenForwardLeakMax;
    let hiddenDir: OutcomeTrigger | null = verticalOk
      ? bestVertical(dotDown, dotUp, thresholds.dirCos)
      : null;
    if (hiddenDir === null && dotBack >= thresholds.dirCos) {
      hiddenDir = "back"; // Phase A 暫定
    }
    if (hiddenDir !== null) {
      return gateOk ? hiddenDir : "hiddenMiss";
    }
  }
  return "noImpact";
}

type StrengthConfig = Pick<
  ScoreConfig["hakkei"],
  | "hakkeiMinForwardVelocity"
  | "hakkeiMinForwardAcceleration"
  | "hakkeiMinForwardDisplacement"
  | "hiddenStrengthScale"
>;

// 前後（高い閾値）と上下（低い閾値＝×hiddenStrengthScale）の強さ判定を出す。
// 踏み込みで勢いが乗る前後は高く、勢いの乗りにくい上下は低く（ユーザ実機フィードバック）。
export function strengthBars(
  speedPeak: number,
  accelPeak: number,
  netDistance: number,
  hk: StrengthConfig,
): { forwardStrengthMet: boolean; hiddenStrengthMet: boolean } {
  const forwardStrengthMet =
    speedPeak > hk.hakkeiMinForwardVelocity &&
    accelPeak > hk.hakkeiMinForwardAcceleration &&
    netDistance > hk.hakkeiMinForwardDisplacement;
  const s = hk.hiddenStrengthScale;
  const hiddenStrengthMet =
    speedPeak > hk.hakkeiMinForwardVelocity * s &&
    accelPeak > hk.hakkeiMinForwardAcceleration * s &&
    netDistance > hk.hakkeiMinForwardDisplacement * s;
  return { forwardStrengthMet, hiddenStrengthMet };
}

// down/up のうち dirCos を満たす大きい方。tie は down>up（§0.23.6・deterministic）。
function bestVertical(dotDown: number, dotUp: number, dirCos: number): OutcomeTrigger | null {
  if (dotDown >= dirCos && dotDown >= dotUp) {
    return "down";
  }
  if (dotUp >= dirCos) {
    return "up";
  }
  return null;
}

// trigger と score から表示・動画を解決する（§0.23.7）。score は表示しない場合も保持。
// outcomes map に無い trigger は安全側（scoreVisible=false, video=none）。
// forward/down/up/back/idleはappConfig validatorで必須化済み。
export function resolveOutcome(
  trigger: OutcomeTrigger,
  score: ScoreBreakdown | null,
  outcomes: ScoreConfig["outcomes"],
): Outcome {
  const entry = outcomes[trigger];
  const video: VideoSelection = entry?.video ?? { kind: "none" };
  return {
    trigger,
    scoreVisible: entry?.scoreVisible ?? false,
    video,
    score,
  };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function neg(v: Vec3): Vec3 {
  return { x: -v.x, y: -v.y, z: -v.z };
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function scale(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

function magnitude(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

// 単位ベクトル化。零ベクトル（degenerate）は null を返し、呼び出し側で安全側に倒す。
function normalizeOrZero(v: Vec3): Vec3 | null {
  const m = magnitude(v);
  if (m < 1e-9) {
    return null;
  }
  return { x: v.x / m, y: v.y / m, z: v.z / m };
}
