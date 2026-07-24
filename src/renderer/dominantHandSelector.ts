// src/renderer/dominantHandSelector.ts
//
// 利き手決定（§0.23.2・M15-02）。`DominantHandCheck` ステップのロジック。
//
// 設計:
//   - 「利き手側の手で一度前へ突く」→ 突いた側の手で利き手を決める（UI は最小・動作で完結）。
//   - 判定は magnitude（左右どちらが大きく動いたか）。方向は見ない＝Calibration の forward に依存しない
//     （DominantHandCheck は Calibration 後だが、ここでは「どちらの手か」だけ決める）。
//   - 短い window で左右それぞれの **net distance（端-端）と speed peak** を見る。
//   - 片手だけが punch しきい値を越えればその手。両手が punch しても netDistance 差が
//     `dominantHandMargin` 未満なら **ambiguous**（「もう一度、片手だけ前へ」）。
//   - 純粋関数 `decideDominantHand` を分離（単体テスト可能）。state は薄い window tracker のみ。

import type { ScoreConfig } from "../shared/configTypes.ts";
import type { DominantHand, HandMotion, MotionSample, Vec3 } from "../shared/types.ts";

export type DominantHandSelectorConfig = Pick<
  ScoreConfig["hakkei"],
  "hakkeiMinForwardVelocity" | "hakkeiMinForwardDisplacement" | "hakkeiWindowMs"
> & { dominantHandMargin: number };

// 片手分の window 集計結果。
export type HandMetric = {
  qualifies: boolean; // punch しきい値（speed peak ∧ net distance）を満たすか
  netDistance: number; // window 端-端の直線距離（m）
  speedPeak: number; // |velocity| のピーク
};

export type DominantHandDecisionStatus = "waiting" | "decided" | "ambiguous";

export type DominantHandDecision = {
  status: DominantHandDecisionStatus;
  hand: DominantHand | null; // decided のときのみ "right"|"left"
};

// 左右の HandMetric から利き手を決める純粋関数（§0.23.2）。
//   - どちらも未達 → waiting（まだ punch していない）
//   - 片方だけ達成 → その手に decided
//   - 両方達成 → netDistance 差が margin 以上なら大きい方に decided、未満なら ambiguous（retry）
export function decideDominantHand(
  right: HandMetric,
  left: HandMetric | null,
  dominantHandMargin: number,
): DominantHandDecision {
  const rq = right.qualifies;
  const lq = left !== null && left.qualifies;

  if (!rq && !lq) {
    return { status: "waiting", hand: null };
  }
  if (rq && !lq) {
    return { status: "decided", hand: "right" };
  }
  if (!rq && lq) {
    return { status: "decided", hand: "left" };
  }
  // 両手が punch（left は非 null）。netDistance 差で判定。
  const diff = right.netDistance - (left as HandMetric).netDistance;
  if (diff >= dominantHandMargin) {
    return { status: "decided", hand: "right" };
  }
  if (-diff >= dominantHandMargin) {
    return { status: "decided", hand: "left" };
  }
  return { status: "ambiguous", hand: null };
}

type WindowSample = { timestampMs: number; position: Vec3; speed: number };

// 片手分の sliding window。net distance（端-端）と speed peak を出す。
class HandWindow {
  private readonly windowMs: number;
  private readonly minSpeed: number;
  private readonly minDistance: number;
  private window: WindowSample[] = [];

  constructor(windowMs: number, minSpeed: number, minDistance: number) {
    this.windowMs = windowMs;
    this.minSpeed = minSpeed;
    this.minDistance = minDistance;
  }

  reset(): void {
    this.window = [];
  }

  observe(timestampMs: number, position: Vec3, velocity: Vec3): HandMetric {
    const windowStartMs = timestampMs - this.windowMs;
    this.window = [...this.window, { timestampMs, position, speed: magnitude(velocity) }].filter(
      (entry) => entry.timestampMs >= windowStartMs && entry.timestampMs <= timestampMs,
    );
    const oldest = this.window.reduce(
      (candidate, entry) => (entry.timestampMs < candidate.timestampMs ? entry : candidate),
      this.window[0] ?? { timestampMs, position, speed: 0 },
    );
    const netDistance = magnitude(sub(position, oldest.position));
    const speedPeak = Math.max(0, ...this.window.map((entry) => entry.speed));
    return {
      qualifies: speedPeak > this.minSpeed && netDistance > this.minDistance,
      netDistance,
      speedPeak,
    };
  }
}

// DominantHandCheck の本体。サンプルを観測し、利き手の決定/曖昧/待機を返す。
//
// reset契約（state配線はM15-05）:
//   observe() は ambiguous でも内部 window を自動 reset しない（pure selector のため）。
//   state 側は次のタイミングで必ず `reset()` を呼ぶこと。さもないと直前の両手動作が window に残り、
//   retry 初期フレームで stale な決定/曖昧に引っ張られる。
//     - DominantHandCheck に入るたび（state entry）
//     - ambiguous から retry へ戻るたび
//     - mode / source / session 変更時
export class DominantHandSelector {
  private readonly config: DominantHandSelectorConfig;
  private readonly right: HandWindow;
  private readonly left: HandWindow;

  constructor(config: DominantHandSelectorConfig) {
    this.config = config;
    this.right = new HandWindow(
      config.hakkeiWindowMs,
      config.hakkeiMinForwardVelocity,
      config.hakkeiMinForwardDisplacement,
    );
    this.left = new HandWindow(
      config.hakkeiWindowMs,
      config.hakkeiMinForwardVelocity,
      config.hakkeiMinForwardDisplacement,
    );
  }

  reset(): void {
    this.right.reset();
    this.left.reset();
  }

  observe(sample: MotionSample): DominantHandDecision {
    const rightMetric = sample.validForScore
      ? this.right.observe(sample.timestampMs, sample.handPosition, sample.velocity)
      : NO_PUNCH;
    const leftMetric = leftMetricOf(sample, this.left);
    return decideDominantHand(rightMetric, leftMetric, this.config.dominantHandMargin);
  }
}

const NO_PUNCH: HandMetric = { qualifies: false, netDistance: 0, speedPeak: 0 };

function leftMetricOf(sample: MotionSample, leftWindow: HandWindow): HandMetric | null {
  const left: HandMotion | null = sample.leftHand;
  if (left === null) {
    return null;
  }
  if (!left.validForScore) {
    return NO_PUNCH;
  }
  return leftWindow.observe(sample.timestampMs, left.handPosition, left.velocity);
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function magnitude(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}
