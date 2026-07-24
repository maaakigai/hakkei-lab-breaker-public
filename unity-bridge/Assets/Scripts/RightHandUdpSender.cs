// RightHandUdpSender.cs
//
// 発勁ラボブレイカー Unity Bridge のコア送信コンポーネント。
//
// 責務（SPEC.md §6.1）:
//   1. mocopi Receiver Plugin が Humanoid Avatar へ反映した後の RightHand / LeftHand Transform を取得する。
//   2. その「反映後ワールド座標」を v2 motion JSON（両手）として localhost UDP で Electron へ送る。
//   3. heartbeat JSON を送る。
//   ここではスコア計算・動画・Result・状態管理は一切持たない。
//
// 重要な設計上の制約:
//   - Bone ID を直接使わない（SPEC.md §6.3）。
//     必ず Animator.GetBoneTransform(HumanBodyBones.RightHand / .LeftHand) 経由で取得する。
//   - 取得タイミングは LateUpdate。Receiver Plugin の姿勢反映後の値を読むため（SPEC.md §6.2）。
//   - 座標は Unity ワールド座標を「そのまま」送る。
//     axisMap / sign / scale / offset 補正は Electron Main 側 (input.config.json.coordinates) が行う。
//   - timestampMs は Unix epoch ではなく「同一 session 開始からの単調増加ms」（SPEC.md §7.2）。
//   - motion packet には必ず連番 seq を入れる（SPEC.md §7.3 / M9-07）。
//   - 1 datagram は 8192 bytes 以下（SPEC.md §7.1）。
//
// 両手v2（protocolVersion 2）:
//   - 両手入力（右手の変位→左手の変位→両手パンチ）のため、leftHand と avatar.hasLeftHand、
//     heartbeat.leftHandReady を追加して protocolVersion 2 で送る。
//   - leftHand の有無判定・null 表現は rightHand と完全対称（Electron packetValidator v2 契約に一致）。
//   - クラス名／ファイル名は据え置き（Scene のコンポーネント参照を壊さないため）。

using System;
using System.Diagnostics;
using System.Globalization;
using System.Net;
using System.Net.Sockets;
using System.Text;
using UnityEngine;
using Debug = UnityEngine.Debug;

namespace HakkeiLabBreaker.UnityBridge
{
    /// <summary>
    /// Receiver Plugin の受信状態を Bridge へ伝えるためのフック。
    /// mocopi Receiver Plugin の実コンポーネントを参照する薄いグルーで実装し、
    /// このコンポーネントの receiverStatusSource にアサインする。
    /// 未アサインの場合は RightHand 座標の更新有無からの簡易ヒューリスティックで代替する。
    /// </summary>
    public interface IReceiverStatusSource
    {
        bool ReceiverReady { get; }

        /// <summary>"not-started" / "receiving" / "stale" / "error" のいずれか。</summary>
        string ReceiverStatus { get; }
    }

    public sealed class RightHandUdpSender : MonoBehaviour
    {
        [Header("送信先 (SPEC.md §7.1)")]
        [SerializeField] private string targetIp = "127.0.0.1";
        [SerializeField] private int targetPort = 45100;

        [Header("Humanoid Avatar")]
        [Tooltip("Receiver Plugin がモーションを反映する Humanoid Animator。未指定なら同一GameObjectから探す。")]
        [SerializeField] private Animator avatarAnimator;

        [Header("送信レート")]
        [Tooltip("motion 送信の目標Hz。標準30、可能なら50 (SPEC.md §7.1)。")]
        [SerializeField] private float motionSendRateHz = 50f;
        [Tooltip("heartbeat 送信Hz。1以上 (SPEC.md §7.1)。")]
        [SerializeField] private float heartbeatRateHz = 2f;

        [Header("Session")]
        [Tooltip("sessionId の接頭辞。再起動ごとに新しい sessionId を発行する。")]
        [SerializeField] private string sessionIdPrefix = "unity";

        [Header("受信状態フック (任意)")]
        [Tooltip("IReceiverStatusSource を実装した MonoBehaviour。未指定なら座標更新からの簡易判定。")]
        [SerializeField] private MonoBehaviour receiverStatusSourceBehaviour;

        // --- 公開診断値 (BridgeStatusView から参照) ---
        public string SessionId { get; private set; } = "";
        public int LastSeq { get; private set; } = -1;
        public float MeasuredSendHz { get; private set; }
        public float MeasuredHeartbeatHz { get; private set; }
        public bool ReceiverReady { get; private set; }
        public string ReceiverStatus { get; private set; } = "not-started";
        public bool AvatarReady { get; private set; }
        public bool RightHandReady { get; private set; }
        public bool LeftHandReady { get; private set; }
        public Vector3 LastRightHand { get; private set; }
        public Vector3 LastLeftHand { get; private set; }
        public string TargetEndpoint => $"{targetIp}:{targetPort}";

        // --- 内部状態 ---
        private UdpClient _udp;
        private IPEndPoint _endpoint;
        private IReceiverStatusSource _receiverStatusSource;
        private Transform _rightHand;
        private Transform _leftHand;

        private readonly Stopwatch _sessionClock = new Stopwatch();
        private long _seq;                 // 次に送る motion packet の seq
        private float _motionAccum;        // motion 送信間隔の積算
        private float _heartbeatAccum;     // heartbeat 送信間隔の積算

        // 実測レート計測用
        private int _motionCountWindow;
        private int _heartbeatCountWindow;
        private float _rateWindowAccum;

        // 簡易 receiver 判定用
        private Vector3 _lastObservedHand;
        private bool _hasObservedHand;
        private float _secondsSinceHandMoved;
        private bool _everReceived;

        private readonly StringBuilder _sb = new StringBuilder(512);
        private const int MaxDatagramBytes = 8192; // SPEC.md §7.1

        private void Awake()
        {
            if (avatarAnimator == null)
            {
                avatarAnimator = GetComponent<Animator>();
            }

            _receiverStatusSource = receiverStatusSourceBehaviour as IReceiverStatusSource;
            if (receiverStatusSourceBehaviour != null && _receiverStatusSource == null)
            {
                Debug.LogWarning(
                    "[RightHandUdpSender] receiverStatusSourceBehaviour は IReceiverStatusSource を実装していません。簡易判定にフォールバックします。");
            }
        }

        private void OnEnable()
        {
            // Unity Bridge は「裏で動き続けるデータ源」。ウィンドウ非フォーカス時（Electron 操作中など）も
            // 送信を止めないよう runInBackground を強制する。Player Settings の同名設定に依存しない。
            Application.runInBackground = true;

            try
            {
                _udp = new UdpClient();
                _endpoint = new IPEndPoint(IPAddress.Parse(targetIp), targetPort);
            }
            catch (Exception e)
            {
                Debug.LogError($"[RightHandUdpSender] UDP 初期化に失敗しました: {e.Message}");
                enabled = false;
                return;
            }

            // 再起動ごとに新しい session を発行（SPEC.md §7.2: sessionId 変化は session 変更として扱われる）。
            SessionId = $"{sessionIdPrefix}-{DateTime.Now:yyyyMMdd-HHmmss}-{UnityEngine.Random.Range(0, 1000):D3}";
            _seq = 0;
            LastSeq = -1;
            _sessionClock.Restart();
            _motionAccum = 0f;
            _heartbeatAccum = 0f;
            _everReceived = false;
            ReceiverStatus = "not-started";

            Debug.Log($"[RightHandUdpSender] 起動 session={SessionId} target={TargetEndpoint}");
        }

        private void OnDisable()
        {
            try { _udp?.Close(); } catch { /* ignore */ }
            _udp = null;
            _sessionClock.Stop();
        }

        // 姿勢反映後の RightHand を読みたいので LateUpdate（SPEC.md §6.2）。
        private void LateUpdate()
        {
            float dt = Time.deltaTime;
            UpdateAvatarState();
            UpdateReceiverStatus(dt);
            UpdateMeasuredRates(dt);

            // --- motion 送信 ---
            _motionAccum += dt;
            float motionInterval = 1f / Mathf.Max(1f, motionSendRateHz);
            if (_motionAccum >= motionInterval)
            {
                _motionAccum -= motionInterval;
                SendMotionPacket();
            }

            // --- heartbeat 送信 ---
            _heartbeatAccum += dt;
            float hbInterval = 1f / Mathf.Max(0.1f, heartbeatRateHz);
            if (_heartbeatAccum >= hbInterval)
            {
                _heartbeatAccum -= hbInterval;
                SendHeartbeatPacket();
            }
        }

        private void UpdateAvatarState()
        {
            bool isHuman = avatarAnimator != null && avatarAnimator.isHuman && avatarAnimator.avatar != null;
            AvatarReady = isHuman;

            if (isHuman)
            {
                // Bone ID を直接使わず、必ず Humanoid マッピング経由で取得する（SPEC.md §6.3）。
                _rightHand = avatarAnimator.GetBoneTransform(HumanBodyBones.RightHand);
                _leftHand = avatarAnimator.GetBoneTransform(HumanBodyBones.LeftHand);
            }
            else
            {
                _rightHand = null;
                _leftHand = null;
            }

            RightHandReady = _rightHand != null;
            if (RightHandReady)
            {
                LastRightHand = _rightHand.position; // 反映後ワールド座標をそのまま使う
            }

            LeftHandReady = _leftHand != null;
            if (LeftHandReady)
            {
                LastLeftHand = _leftHand.position; // 反映後ワールド座標をそのまま使う
            }
        }

        private void UpdateReceiverStatus(float dt)
        {
            if (_receiverStatusSource != null)
            {
                ReceiverReady = _receiverStatusSource.ReceiverReady;
                ReceiverStatus = Normalize(_receiverStatusSource.ReceiverStatus);
                if (ReceiverStatus == "receiving") _everReceived = true;
                return;
            }

            // --- フォールバック: RightHand の動きから受信状況を推定 ---
            if (RightHandReady)
            {
                if (_hasObservedHand && (LastRightHand - _lastObservedHand).sqrMagnitude > 1e-6f)
                {
                    _secondsSinceHandMoved = 0f;
                    _everReceived = true;
                }
                else
                {
                    _secondsSinceHandMoved += dt;
                }
                _lastObservedHand = LastRightHand;
                _hasObservedHand = true;
            }
            else
            {
                _secondsSinceHandMoved += dt;
            }

            if (!_everReceived)
            {
                ReceiverStatus = "not-started";
                ReceiverReady = false;
            }
            else if (_secondsSinceHandMoved > 2f)
            {
                ReceiverStatus = "stale";
                ReceiverReady = true; // 一度は受信できている
            }
            else
            {
                ReceiverStatus = "receiving";
                ReceiverReady = true;
            }
        }

        private void UpdateMeasuredRates(float dt)
        {
            _rateWindowAccum += dt;
            if (_rateWindowAccum >= 1f)
            {
                MeasuredSendHz = _motionCountWindow / _rateWindowAccum;
                MeasuredHeartbeatHz = _heartbeatCountWindow / _rateWindowAccum;
                _motionCountWindow = 0;
                _heartbeatCountWindow = 0;
                _rateWindowAccum = 0f;
            }
        }

        private long SessionTimestampMs()
        {
            // 単調増加。PC 時計変更の影響を受けない（SPEC.md §7.2）。
            return _sessionClock.ElapsedMilliseconds;
        }

        private void SendMotionPacket()
        {
            long seq = _seq++;
            LastSeq = (int)seq;
            long ts = SessionTimestampMs();

            bool isTracked = AvatarReady && RightHandReady && ReceiverStatus == "receiving";

            _sb.Clear();
            _sb.Append('{');
            AppendCommon(_sb, "motion", ts);
            _sb.Append(",\"seq\":").Append(seq.ToString(CultureInfo.InvariantCulture));
            _sb.Append(",\"isTracked\":").Append(isTracked ? "true" : "false");

            if (isTracked)
            {
                _sb.Append(",\"rightHand\":");
                AppendVec3(_sb, LastRightHand);
            }
            else
            {
                // valid unavailable packet（SPEC.md §7.3）: rightHand は null。
                _sb.Append(",\"rightHand\":null");
            }

            // 両手v2: leftHand は rightHand と対称。tracked かつ LeftHand 取得済みのときだけ座標、
            // それ以外は null（Electron packetValidator v2 の leftAvailable 判定に一致）。
            bool leftTracked = isTracked && LeftHandReady;
            if (leftTracked)
            {
                _sb.Append(",\"leftHand\":");
                AppendVec3(_sb, LastLeftHand);
            }
            else
            {
                _sb.Append(",\"leftHand\":null");
            }

            // avatar block
            Vector3 forward = avatarAnimator != null ? avatarAnimator.transform.forward : Vector3.forward;
            _sb.Append(",\"avatar\":{");
            _sb.Append("\"isHuman\":").Append(AvatarReady ? "true" : "false");
            _sb.Append(",\"hasRightHand\":").Append(RightHandReady ? "true" : "false");
            _sb.Append(",\"hasLeftHand\":").Append(LeftHandReady ? "true" : "false");
            _sb.Append(",\"forward\":");
            AppendVec3(_sb, forward);
            _sb.Append('}');

            _sb.Append('}');

            if (Send(_sb))
            {
                _motionCountWindow++;
            }
        }

        private void SendHeartbeatPacket()
        {
            long ts = SessionTimestampMs();

            _sb.Clear();
            _sb.Append('{');
            AppendCommon(_sb, "heartbeat", ts);
            _sb.Append(",\"receiverReady\":").Append(ReceiverReady ? "true" : "false");
            _sb.Append(",\"receiverStatus\":\"").Append(ReceiverStatus).Append('"');
            _sb.Append(",\"avatarReady\":").Append(AvatarReady ? "true" : "false");
            _sb.Append(",\"rightHandReady\":").Append(RightHandReady ? "true" : "false");
            _sb.Append(",\"leftHandReady\":").Append(LeftHandReady ? "true" : "false");
            // 自己申告値。Gate 判定では Electron Main の実測値が優先される（SPEC.md §7.4）。
            float frameRate = Time.smoothDeltaTime > 0f ? 1f / Time.smoothDeltaTime : 0f;
            float reportedSendHz = MeasuredSendHz > 0f ? MeasuredSendHz : motionSendRateHz;
            _sb.Append(",\"frameRate\":").Append(FormatFloat(Mathf.Max(0.001f, frameRate)));
            _sb.Append(",\"sendRateHz\":").Append(FormatFloat(Mathf.Max(0.001f, reportedSendHz)));
            _sb.Append('}');

            if (Send(_sb))
            {
                _heartbeatCountWindow++;
            }
        }

        private void AppendCommon(StringBuilder sb, string type, long timestampMs)
        {
            sb.Append("\"protocolVersion\":2");
            sb.Append(",\"type\":\"").Append(type).Append('"');
            sb.Append(",\"sessionId\":\"").Append(SessionId).Append('"');
            sb.Append(",\"timestampMs\":").Append(timestampMs.ToString(CultureInfo.InvariantCulture));
            sb.Append(",\"source\":\"unity-bridge\"");
        }

        private static void AppendVec3(StringBuilder sb, Vector3 v)
        {
            sb.Append("{\"x\":").Append(FormatFloat(v.x));
            sb.Append(",\"y\":").Append(FormatFloat(v.y));
            sb.Append(",\"z\":").Append(FormatFloat(v.z));
            sb.Append('}');
        }

        private static string FormatFloat(float f)
        {
            if (float.IsNaN(f) || float.IsInfinity(f)) return "0";
            // 小数6桁で十分。NumberFormatInfo.InvariantInfo でロケール非依存。
            return f.ToString("0.######", CultureInfo.InvariantCulture);
        }

        private static string Normalize(string status)
        {
            switch (status)
            {
                case "receiving":
                case "stale":
                case "error":
                case "not-started":
                    return status;
                default:
                    return "error";
            }
        }

        private bool Send(StringBuilder sb)
        {
            if (_udp == null) return false;

            int byteCount = Encoding.UTF8.GetByteCount(sb.ToString());
            if (byteCount > MaxDatagramBytes)
            {
                // 通常起こり得ないが、起きたら Electron 側で JSON_TOO_LARGE になるので送らない。
                Debug.LogWarning($"[RightHandUdpSender] datagram が {byteCount} bytes で上限 {MaxDatagramBytes} を超過。送信中止。");
                return false;
            }

            try
            {
                byte[] bytes = Encoding.UTF8.GetBytes(sb.ToString());
                _udp.Send(bytes, bytes.Length, _endpoint);
                return true;
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[RightHandUdpSender] 送信失敗: {e.Message}");
                return false;
            }
        }
    }
}
