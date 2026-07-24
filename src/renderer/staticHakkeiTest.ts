// src/renderer/staticHakkeiTest.ts
//
// SPEC §0.16.1: static-hakkei-false-positive-test。
// Diagnostics/Dev menu から起動し、HakkeiReady timeout を介さず Hakkei detector だけを
// windowMs（既定10秒）評価する誤検出測定ハーネス。
//
// 両手v2 での位置づけ（重要・P3b レビュー指摘への回答）:
//   本ハーネスは**右手単手**の `HakkeiDetector`（複合条件＝前方速度∧加速度∧変位）を測る。
//   実ライブ経路は両手 `DualHakkeiDetector`（右手と左手が各々複合条件を満たし、かつ同期 window 内）
//   だが、両手は **AND かつ同期** のため単手よりも誤発火がさらに困難。
//   よって「右手単手で誤検出0」が成立すれば、両手ライブ経路の誤検出0は自明に成り立つ
//   （単手＝両手 AND の保守的な上限＝より厳しい下限テスト）。
//   左手単独のジッタは**それだけでは誤インパクトを起こせない**（両手同期が必須）ため、
//   右手のみの測定でも production gate として保守的に妥当。
//   detector レベルの両手静止→検出0は hakkei-detector.test.mjs「dual hand stationary samples never detect」で担保。
//
// 契約（SPEC §0.16.1）:
//   - 入力: active source の validForScore=true sample だけ。
//   - cooldown: test 開始時に detector.reset() で reset。
//   - 出力: staticFalseHakkeiCount10s。motion:diagnostics payload には入れない（Renderer ローカル）。
//   - PASS: window 内の誤検出が maxCount（config staticFalseHakkeiMaxCount=0）以下。
//   - score/動画へは進まない。通常 play path とは分けて記録する。
//
// forwardVector は通常の HakkeiReady と同じく，Calibration 済みの値または既定値を呼出側から受ける．
//
// DOM/timer を持たない純粋ロジックにし、app.ts 側が sample 供給と表示を担う。

import { rightHandKinematics, type HakkeiDetector } from "./hakkeiDetector.ts";
import type { MotionSample, Vec3 } from "../shared/types.ts";

export type StaticHakkeiTestStatus = {
  running: boolean;
  done: boolean;
  windowMs: number;
  elapsedMs: number;
  count: number; // staticFalseHakkeiCount（window 内の誤検出回数）
  sampleCount: number; // 評価した validForScore sample 数
  passed: boolean | null; // 完了後のみ true/false
};

export class StaticHakkeiFalsePositiveTest {
  private readonly detector: HakkeiDetector;
  private readonly forwardVector: Vec3;
  private readonly windowMs: number;
  private readonly maxCount: number;
  private startMs = 0;
  private running = false;
  private done = false;
  private count = 0;
  private samples = 0;

  constructor(detector: HakkeiDetector, forwardVector: Vec3, windowMs: number, maxCount: number) {
    this.detector = detector;
    this.forwardVector = forwardVector;
    this.windowMs = windowMs;
    this.maxCount = maxCount;
  }

  /** test 開始。cooldown を reset し、カウンタを初期化する（SPEC §0.16.1）。 */
  start(nowMs: number): void {
    this.detector.reset();
    this.startMs = nowMs;
    this.running = true;
    this.done = false;
    this.count = 0;
    this.samples = 0;
  }

  /**
   * active source の sample を1件評価する。
   * window 経過後の sample は確定処理だけ行い計上しない。validForScore=false は無視。
   */
  feed(sample: MotionSample, nowMs: number): void {
    if (!this.running) {
      return;
    }
    if (nowMs - this.startMs >= this.windowMs) {
      this.finish();
      return;
    }
    if (!sample.validForScore) {
      return;
    }
    this.samples++;
    if (this.detector.observe(rightHandKinematics(sample), this.forwardVector).detected) {
      this.count++;
    }
  }

  /** 時間切れで確定する（sample が止まっても呼べる）。 */
  finish(): void {
    if (!this.running) {
      return;
    }
    this.running = false;
    this.done = true;
  }

  status(nowMs: number): StaticHakkeiTestStatus {
    const elapsed = this.done
      ? this.windowMs
      : this.running
      ? Math.min(this.windowMs, nowMs - this.startMs)
      : 0;
    return {
      running: this.running,
      done: this.done,
      windowMs: this.windowMs,
      elapsedMs: elapsed,
      count: this.count,
      sampleCount: this.samples,
      passed: this.done ? this.count <= this.maxCount : null,
    };
  }
}
