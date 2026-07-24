// src/shared/recordingTypes.ts
//
// M15-09 実機チューニング用の記録フォーマット（docs/M15-09-experiment.md）。
// 「trial 境界付きの連続 MotionSample 記録」を保存し、本番コードで offline replay して
// 閾値を決める。再現性のため、記録は完全な MotionSample 列＋calibration＋config snapshot を持つ。

import type { AppConfig, InputConfig, ScoreConfig } from "./configTypes.ts";
import type { DominantHand, MotionSample, Vec3 } from "./types.ts";

// 意図ラベル（ground truth）。negative/edge classを含む。
export type TrialLabel =
  | "forward"
  | "down"
  | "up"
  | "back"
  | "weak-forward"
  | "static"
  | "sideways"
  | "diagonal-forward-up"
  | "diagonal-forward-down"
  | "non-dominant-hand"
  | "small-fast-jitter";

// 試行の有効性に対する操作者の判断。主観はここに限定して宣言する。
export type OperatorVerdict = "valid" | "bad-form" | "uncertain";

// trial 境界（frames への参照は timestampMs 範囲で行う）。
export type TrialMarker = {
  trialId: string;
  label: TrialLabel;
  operatorVerdict: OperatorVerdict;
  dominantHand: DominantHand;
  startTimestampMs: number; // この trial の最初の sample.timestampMs
  endTimestampMs: number; // 最後の sample.timestampMs
  // この trial で発勁直前までに積んだチャージ raw（Σ|Δp|）。hiddenChargeGate 掃引に使う。
  // 記録時に charge を取っていなければ 0（forward/down 等の単独 punch 評価では gate 影響なし）。
  chargeRaw: number;
};

export type CalibrationSnapshotForRecord = {
  // measured=実測calibration / default=config既定軸のfallback。方向評価の前提を記録する。
  source: "measured" | "default";
  forwardVector: Vec3;
  upVector: Vec3;
  neutralHandPositionRaw: Vec3 | null;
};

// 記録時の config スナップショット（再評価の決定性・config drift 回避のため同梱）。
export type RecordedConfigSnapshot = {
  score: ScoreConfig;
  input: InputConfig;
  app: AppConfig;
};

export type RecordingFile = {
  schemaVersion: 1;
  recordedAtIso: string; // 記録時刻（情報用・評価には使わない）
  commitSha: string; // code version（"unknown" 可・runbook で別途控える）
  note: string;
  dominantHand: DominantHand; // セッション既定の利き手
  calibration: CalibrationSnapshotForRecord;
  config: RecordedConfigSnapshot;
  // 連続ストリーム（timestampMs 昇順）。source of truth。
  frames: MotionSample[];
  // trial 境界マーカー。
  trials: TrialMarker[];
};
