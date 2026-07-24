// MocopiReceiverStatusBridge.cs
//
// mocopi Receiver Plugin の受信状態を RightHandUdpSender へ渡す「グルー」。
//
// RightHandUdpSender は Receiver Plugin の型に直接依存しないため、
// このスクリプトが Plugin 側（MocopiAvatar）の状態を読み取り、IReceiverStatusSource として公開する。
// RightHandUdpSender の receiverStatusSourceBehaviour にこのコンポーネントをアサインすると、
// 簡易ヒューリスティック（RightHand の動き）ではなく実際の受信状態が heartbeat に反映される。
//
// 受信判定は MocopiAvatar.FrameArrivalRate（直近1秒に到着したフレーム数）を使う:
//   - frameArrivalRate > 0                → "receiving"（receiverReady=true）
//   - 一度でも受信した後に 0 が staleSec 継続 → "stale"（receiverReady=true: 既に一度は受信済み）
//   - まだ一度も受信していない              → "not-started"（receiverReady=false）
// MocopiAvatar 未アサインで forceReceiving=false なら "not-started"。

using Mocopi.Receiver;
using UnityEngine;

namespace HakkeiLabBreaker.UnityBridge
{
    public sealed class MocopiReceiverStatusBridge : MonoBehaviour, IReceiverStatusSource
    {
        [Tooltip("mocopi Receiver Plugin がフレームを反映する MocopiAvatar。Receiver と同じ Avatar を参照する。")]
        [SerializeField] private MocopiAvatar mocopiAvatar;

        [Tooltip("0フレーム/秒がこの秒数継続したら stale 扱いにする。")]
        [SerializeField] private float staleSeconds = 1.5f;

        [Tooltip("Plugin を使わず手動で受信中とみなす（mocopi 無しの開発用）。")]
        [SerializeField] private bool forceReceiving;

        public bool ReceiverReady { get; private set; }
        public string ReceiverStatus { get; private set; } = "not-started";

        private bool _everReceived;
        private float _secondsSinceFrame;

        private void Update()
        {
            if (forceReceiving)
            {
                _everReceived = true;
                ReceiverReady = true;
                ReceiverStatus = "receiving";
                return;
            }

            if (mocopiAvatar == null)
            {
                ReceiverReady = false;
                ReceiverStatus = "not-started";
                return;
            }

            // FrameArrivalRate は直近1秒の到着フレーム数。> 0 なら受信中。
            if (mocopiAvatar.FrameArrivalRate > 0f)
            {
                _everReceived = true;
                _secondsSinceFrame = 0f;
                ReceiverReady = true;
                ReceiverStatus = "receiving";
                return;
            }

            _secondsSinceFrame += Time.deltaTime;

            if (!_everReceived)
            {
                ReceiverReady = false;
                ReceiverStatus = "not-started";
            }
            else if (_secondsSinceFrame >= staleSeconds)
            {
                // 一度は受信できているので receiverReady は true のまま、status だけ stale。
                ReceiverReady = true;
                ReceiverStatus = "stale";
            }
            else
            {
                ReceiverReady = true;
                ReceiverStatus = "receiving";
            }
        }
    }
}
