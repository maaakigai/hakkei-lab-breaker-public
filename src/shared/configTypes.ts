// src/shared/configTypes.ts
//
// Shared config file types for app/input/score config.

import type { DominantHand, InputMode, KeyboardKey, OutcomeTrigger, Rank, VideoSelection, Vec3 } from "./types.ts";

export type TimerConfig = {
  calibrationPrepMs: number;
  readyCountdownMs: number;
  chargePrepMs: number;
  // 単手1段チャージ（§0.23.3）。旧 verticalChargeMs/forwardChargeMs は M15-05 で整理。
  chargeMs: number;
  verticalChargeMs: number;
  forwardChargeMs: number;
  // 構え（心の準備）猶予。Charge 完了後、パンチ検出を arm するまでの数秒（この間は検出しない）。
  hakkeiPrepMs: number;
  hakkeiReadyTimeoutMs: number;
  // idle 隠しイベント（§0.23.6）。HakkeiReady 開始からこの時間 低運動量で idle 発火。
  // idleEnabled=true のときのみ idle を計測し、不変条件
  // hakkeiReadyTimeoutMs >= idleEventMs + grace を appConfig で検証（§0.23.4）。
  // M15-06でidleを実装するまでidleEnabled=falseとし、現行timeoutを伸ばさない。
  idleEnabled: boolean;
  idleEventMs: number;
  impactDelayMs: number;
};

export type AppConfig = {
  schemaVersion: 1;
  appName: string;
  defaultInputMode: InputMode;
  locale: "ja-JP";
  timers: TimerConfig;
  video: { stalledTimeoutMs: number; endedGraceMs: number };
  audio: {
    missingIsFatal: false;
    bgm: {
      file: string;
      loop: true;
      volume: number;
      autoplay: true;
    };
    criticalBgm: {
      file: string;
      loop: true;
      volume: number;
    };
    chargeSound: {
      file: string;
      loop: true;
      volume: number;
    };
    overchargeSound: {
      file: string;
      loop: true;
      volume: number;
    };
    transitionSound: {
      file: string;
      volume: number;
    };
    criticalVideoStartSound: {
      file: string;
      volume: number;
    };
    phaseCues: {
      chargeStart: { file: string; volume: number; image: string };
      stance: { file: string; volume: number; image: string };
      stanceOvercharge: { file: string; volume: number; image: string };
      punch: { file: string; volume: number; image: string };
      punchOvercharge: { file: string; volume: number; image: string };
      // 構え/パンチの切替が起きる何秒前に効果音を鳴らすか（0〜1秒）。
      stanceLeadSec: number;
      punchLeadSec: number;
    };
    resultVoiceSfx: {
      normalCount: number;
      normalVolume: number;
      criticalVideoNormalVolume: number;
      uniqueVolume: number;
      featuredVolume: number;
      featuredProbability: number;
      baseDelayMs: number;
      staggerMs: number;
      jitterMs: number;
    };
  };
  diagnostics: { statusIntervalMs: number; diagnosticsIntervalMs: number };
  remoteSession: {
    enabled: boolean;
    httpBaseUrl: string;
    wsUrl: string;
    fallbackPollingMs: number;
    reconnectMinMs: number;
    reconnectMaxMs: number;
  };
};

export type AxisName = "x" | "y" | "z";

export type CoordinateConfig = {
  axisMap: { x: AxisName; y: AxisName; z: AxisName };
  sign: { x: 1 | -1; y: 1 | -1; z: 1 | -1 };
  scaleMultiplier: number;
  offset: Vec3;
  defaultUpVector: Vec3;
  defaultForwardVector: Vec3;
  coordinateWarnAbsM: number;
  coordinateInvalidAbsM: number;
};

export type KeyboardConfig = {
  sampleRateHz: number;
  tapVerticalStepM: number;
  tapForwardStepM: number;
  tapSpeedMps: number;
  leftChargeKey: KeyboardKey;
  enterForwardDisplacementM: number;
  enterDurationMs: number;
  // Enter パンチの固定 intensity（debug・timing 非依存）。位置パルスの |accel| は frame dt に敏感で
  // 発火をframe timingに依存させないため、Enter down-edgeで1-2 sampleだけaccelerationを固定値に置く。
  // intensityThresholdKeyboard を十分超える値にする。強弱の debug は不要（BLE が角速度で担う）。
  enterPunchIntensity: number;
  keyReleaseStaleMs: number;
};

export type InputConfig = {
  schemaVersion: 1;
  inputCheck: {
    // recent-only: 現在受信中のときだけ mocopi ready。
    // sticky-after-first: InputCheck中に一度受信したら ready を維持（旧仕様）。
    mocopiBleReadyPolicy: "recent-only" | "sticky-after-first";
    mocopiBleRecentWindowMs: number;
  };
  udp: {
    host: "127.0.0.1";
    port: number;
    mocopiBlePort: number; // v2: BLE sidecar/replay からの mocopi-ble packet 受信ポート（V4）。
    maxDatagramBytes: number;
    heartbeatTimeoutMs: number;
    motionTimeoutMs: number;
    lowSampleRateHz: number;
    requiredSampleRateHz: number;
    requireSeq: true;
  };
  coordinates: CoordinateConfig;
  filter: {
    referenceHz: number;
    minDtMs: number;
    maxDtMs: number;
    maxPositionJump: number;
    maxReasonableVelocity: number;
    maxReasonableAcceleration: number;
    positionEmaAlpha: number;
    velocityEmaAlpha: number;
    accelerationEmaAlpha: number;
  };
  jitter: {
    measurementWindowMs: number;
    rawJitterRms2sMaxM: number;
    rawMaxJitter2sMaxM: number;
    rawDrift2sMaxM: number;
    filteredJitterRms2sMaxM: number;
    filteredMaxJitter2sMaxM: number;
    filteredDrift2sMaxM: number;
    staticFalseHakkeiWindowMs: number;
    staticFalseHakkeiMaxCount: number;
  };
  keyboard: KeyboardConfig;
};

export type RankThreshold = { rank: Rank; minPower: number };

export type VideoLevelConfig = {
  level: 0 | 1 | 2 | 3 | 4 | 5;
  minPower: number;
  maxPower: number | null;
  file?: string;
  folder?: string;
  files?: string[];
};

// 見積書（研究室 破損見積書）の 1 品目。損害総額（Lv アンカー補間で決まる）を
// 品目へ配分するときの「単価レンジ・登場 Lv・最大数量・出やすさ」を持つ。
// 実際の金額は damageEstimate.ts が seed で単価と数量を決め、Σ=総額 になるよう按分する。
export type ResultDamageReportItemConfig = {
  label: string;
  unit: string;
  unitPriceMin: number; // この品目 1 個の再購入/復旧費 下限（円）
  unitPriceMax: number; // 同上限（seed でこの範囲から 1 個単価を選ぶ）
  minLevel: number; // この品目が出始める videoLevel（低Lvでは壊れていない物を出さない）
  maxCount: number; // 1 見積書に載せる最大数量
  weight: number; // 品目選択の出やすさ（>0・相対）
};

// 損害総額カーブのアンカー点（power → 円）。区分線形で補間する（非線形・Lv/ランクを内包）。
// 損害総額カーブ（非線形・加速→上限飽和）。
export type DamageCurveConfig = {
  deadZonePower: number; // これ以下の power は損害 0（空振り域）
  maxPower: number; // この power で損害が上限（maxYen）に達する
  maxYen: number; // 損害総額の上限（円）
  gamma: number; // カーブの効き。>1 で加速的（中盤で一気に伸び上限で頭打ち）、1 で線形
};

export type ScoreConfig = {
  schemaVersion: 1;
  normalization: {
    rightChargeMin: number;
    rightChargeMax: number;
    rightChargeNoiseThreshold: number;
    leftChargeMin: number;
    leftChargeMax: number;
    leftChargeNoiseThreshold: number;
    hakkeiVelocityMin: number;
    hakkeiVelocityMax: number;
    hakkeiAccelerationMin: number;
    hakkeiAccelerationMax: number;
    hakkeiDisplacementMin: number;
    hakkeiDisplacementMax: number;
  };
  hakkei: {
    // 両手v2 D案: 検出は magnitude（大きさ）主判定＋ net変位 ＋ ゆるい前方 gate。
    // hakkeiMinForwardVelocity/Acceleration は |velocity|/|acceleration| の最小（前方射影ではない・左右対称）。
    // hakkeiMinForwardDisplacement は window端-端の net直線距離の最小。
    // hakkeiForwardGateMin は net変位ベクトルの前方成分 dot(netDelta, forward) の最小（方向 gate・検出可否のみ）。
    hakkeiMinForwardVelocity: number;
    hakkeiMinForwardAcceleration: number;
    hakkeiMinForwardDisplacement: number;
    hakkeiForwardGateMin: number;
    hakkeiWindowMs: number;
    dualHakkeiSyncWindowMs: number;
    hakkeiCooldownMs: number;
    velocityWeight: number;
    accelerationWeight: number;
    displacementWeight: number;
    // 方向判定（§0.23.5・M15）。forwardCos < dirCos を保つ。
    forwardCos: number; // 前方とみなすコサイン（暫定 0.75）
    dirCos: number; // 下/上/後ろとみなすコサイン（暫定 0.80）
    // up/downを許す前方成分の上限（§0.23.6）。前突きの腕の弧で
    // 縦成分が出ても |dot(dir,forward)| がこれを超えたら up/down にしない（前突きの誤分類防止）。
    hiddenForwardLeakMax: number; // 暫定 0.4（0..1・sweep 対象）
    // up/down の強さ閾値の倍率（§0.23.6）。前後は踏み込みで勢いが乗るが上下は乗りにくいため、
    // up/down は forward 強さ閾値 × このスケールで判定（小さいほど弱い上下も拾う）。(0,1]。
    hiddenStrengthScale: number; // 暫定 0.6
    // idle 低運動量しきい値（§0.23.6）。HakkeiReady の net距離/速度ピークがこれ以下なら静止扱い。
    idleMaxNetDistance: number; // m
    idleMaxSpeed: number; // m/s
  };
  // 隠し発火に必要なチャージ量（§0.23.6）。暫定 0=未調整。
  hiddenChargeGate: number;
  // v2 magnitude-only punch（SPEC v2・角速度ベース）。しきい値は実機測定後もconfigで調整可能にする。
  // intensity の単位は source 依存（BLE=角速度 deg/s 実機 still~2/punch~800 / keyboard=擬似|accel|）。
  // 閾値の source 整合（keyboard/BLE で同じ閾値が効くよう正規化）は V3c 配線時に調整する。
  punch: {
    // パンチ発火の intensity ピーク閾値。intensity の単位は source 依存のため source 別に持つ（案1）。
    intensityThresholdKeyboard: number; // keyboard 擬似 |accel|。実測: Space連打~339 < 600 < Enter~1253（tools/measure_keyboard_intensity.mjs）
    // パンチ検出スパイクの **開始**閾値。これを超えたらピーク追跡開始（構えの腕引き ~159 の上に置く）。
    intensityThresholdBle: number; // mocopi-ble 角速度 deg/s（構え~159 < 500 < 本気~1540）
    // スパイク **終了**（発火）閾値の比率。stop = start × punchReleaseRatio。減衰でこれを下回ると真のピークで発火。
    punchReleaseRatio: number; // (0,1]
    chargeNoiseFloor: number; // charge 積算の最小増分（noise 以下は積まない）
    chargeReadyThreshold: number; // チャージ「十分」の目安（BLE 角速度回転°スケール・メーター表示用）
    participantAssistChargeReadyThreshold: number; // Shift の Participant Assist 中だけ使う表示100%基準
    chargeReadyThresholdKeyboard: number; // 同上 keyboard（擬似手位置 m スケール・Space 数回で満タン目安）
    cooldownMs: number; // パンチ後の不応期
    // 威力スコアモデル（2026-06-27 確定 → 2026-07-06 チャージ補正を割合基準ロジスティックに再設計）。
    // power = powerK · detectGate · scoreGate^scoreGateGamma · (noChargeBase+chargeWeight·A)^chargeGamma · (punchBase+punchWeight·B)
    //   A=1/(1+exp(−(f−chargeScoreMid)/chargeScoreWidth))  … f=chargeRaw/chargeReadyThreshold（割合・飽和曲線）
    //   B=clamp01((peak-punchMin)/(punchMax-punchMin)) … パンチ威力（従・微ボーナス）
    //   detectGate=clamp01((peak-detectGateMin)/(detectGateFull-detectGateMin)) … 空振り足切り
    //   scoreGate =clamp01((peak-scoreGateMin)/(scoreGateFull-scoreGateMin))    … 「ゆっくり満タン」が高Lvに行く穴を塞ぐ
    // スコア用チャージ曲線（割合 f 基準・source 非依存）。UI表示%（線形・上限なし）とは別物。
    chargeScoreMid: number; // A=0.5 になる割合 f（表示%/100）。例 0.60 = 表示60%
    chargeScoreWidth: number; // ロジスティックの立ち上がり幅（f 単位）。小さいほど急峻。例 0.133
    chargeMax: number; // 【非推奨・スコア未使用】旧 A=100% の chargeRaw。曲線移行で参照されない（後方互換で残置）
    chargeMaxKeyboard: number; // 【非推奨・スコア未使用】旧 keyboard 版
    punchMin: number; // B=0 の peak 角速度 deg/s
    punchMax: number; // B=100% の peak 角速度 deg/s
    detectGateMin: number; // 発火 gate 下限（これ未満は power 0）
    detectGateFull: number; // 発火 gate 上限（これ以上で full）
    scoreGateMin: number; // スコア gate 下限（弱パンチの高Lv化を防ぐ）
    scoreGateFull: number; // スコア gate 上限（本気 min ~1229 の直下 ~1200）
    scoreGateGamma: number; // scoreGate の指数（緩めに効かせる ~0.7）
    noChargeBase: number; // チャージ0でも残る下駄（タメ無し本気=Lv1 を作る ~0.12）
    chargeWeight: number; // チャージ項の重み（1-noChargeBase ~0.88）
    chargeGamma: number; // チャージカーブの指数（~1.7・前半緩く満タンで大きく報う）
    punchBase: number; // B=0 でも残る下駄（~0.45）
    punchWeight: number; // B 項の重み（~0.55）
    powerK: number; // 絶対スケール係数（Lv5 到達に合わせる ~780000）
  };
  // 利き手決定（§0.23.2）。default=Keyboard 既定。margin=左右差マージン。
  dominantHand: { default: DominantHand; dominantHandMargin: number };
  // トリガー別アウトカム（§0.23.7）。forward は必須（appConfig で検証）。
  // 未知 trigger key は CONFIG_INVALID。video は明示的な VideoSelection。
  outcomes: Partial<Record<OutcomeTrigger, { scoreVisible: boolean; video: VideoSelection }>>;
  power: {
    powerCoefficient: number;
    yenCoefficient: number; // 【非推奨・損害額未使用】旧「power×係数」線形。damageCurve へ移行（後方互換で残置）
    // 損害総額の非線形カーブ（区分線形の直線感を排し、加速→上限飽和のなめらかな曲線に）。
    //   yen = maxYen · clamp01((power − deadZonePower)/(maxPower − deadZonePower))^gamma
    damageCurve: DamageCurveConfig;
    damageVarianceRatio: number; // 損害総額に乗せる ±乱数の割合（0..1・seed 量子化で同一結果は再現）
  };
  rankThresholds: RankThreshold[];
  scoreDisplay: {
    scoreDecimalPlaces: number;
    powerDecimalPlaces: number;
    damageYenDecimalPlaces: number;
  };
  resultDamageReport: {
    maxLinesByLevel: number[]; // videoLevel(0..5) ごとの見積書 最大行数（末尾の調整行を含む）
    reserveRatio: number; // 総額のうち末尾「調整行」へ最低限残す割合（0..1・Σ=総額 を保つ緩衝）
    // 単価がこの額以下＝「ワークホース品」（モニタ/机/椅子/センサ等の 5桁級）。多数壊れる品として
    // 数量優先で先に並べる。これを超える品＝高額品で、残予算を少数行で吸収する（調整行の肥大化防止）。
    workhorsePriceCeiling: number;
    // videoLevel ごとに、品目予算のうちワークホース品へ回す割合（0..1）。残りは高額品へ。
    // 低Lvは 1.0（安物中心）、高Lvは小さく（高額機材＋原状回復が主役）。
    workhorseBudgetShareByLevel: number[];
    // videoLevel ごとに、高額品へ割り当てる行数（残予算の吸収用）。
    bigTicketLinesByLevel: number[];
    reconcileLabel: string; // 調整行のラベル（低Lv＝粉塵清掃など）
    reconcileLabelHigh: string; // 調整行のラベル（reconcileHighLevel 以上＝原状回復工事など）
    reconcileHighLevel: number; // このレベル以上で reconcileLabelHigh を使う
    criticalLabInclusiveLabel: string; // Critical 見積書の「研究室設備 全損 一式」行ラベル
    items: ResultDamageReportItemConfig[];
  };
  videoLevels: VideoLevelConfig[];
};

export type CriticalDamageItemConfig = {
  label: string;
  countLabel: string;
  bonusDamageYen: number | string;
};

export type CriticalOutcomeConfig = {
  id: string;
  label: string;
  weight: number;
  labVideoFile?: string;
  videoFile: string;
  damageItems: CriticalDamageItemConfig[];
};

export type CriticalConfig = {
  schemaVersion: 1;
  enabled: boolean;
  baseRateOnSRank: number;
  maxRateOnSRank: number;
  rateGamma: number;
  defaultOutcomeId: string;
  outcomes: CriticalOutcomeConfig[];
};

export type AppConfigBundle = {
  schemaVersion: 1;
  loadedAtMs: number;
  runtime: {
    uiMode: "release" | "debug";
    localMode: boolean;
    demoQr: boolean;
  };
  app: AppConfig;
  input: InputConfig;
  score: ScoreConfig;
  critical: CriticalConfig;
  sourcePaths: {
    app: "config/app.config.json";
    input: "config/input.config.json";
    score: "config/score.config.json";
    critical: "config/critical.config.json";
  };
};
