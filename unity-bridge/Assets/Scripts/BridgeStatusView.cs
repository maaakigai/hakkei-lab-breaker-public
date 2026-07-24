// BridgeStatusView.cs
//
// Unity Bridge の最低限の診断表示（SPEC.md §6.4）。
// Receiver / Avatar / RightHand / LeftHand / Send Hz / Heartbeat Hz / Target / Last Seq / 両手座標を出す。
//
// 画面 UI 構築を不要にするため OnGUI() の即時モードで描画する。
// 同一 GameObject か Inspector で RightHandUdpSender を参照させる。

using UnityEngine;

namespace HakkeiLabBreaker.UnityBridge
{
    public sealed class BridgeStatusView : MonoBehaviour
    {
        [SerializeField] private RightHandUdpSender sender;

        [Header("表示位置・サイズ")]
        [SerializeField] private int marginPx = 12;
        [SerializeField] private int panelWidthPx = 360;
        [SerializeField] private int fontSizePx = 14;

        private GUIStyle _labelStyle;
        private GUIStyle _boxStyle;

        private void Awake()
        {
            if (sender == null)
            {
                sender = GetComponent<RightHandUdpSender>();
            }
        }

        private void OnGUI()
        {
            if (sender == null) return;

            EnsureStyles();

            // 10行ぶんの高さを確保する（最後の行が切れないように）。
            var rect = new Rect(marginPx, marginPx, panelWidthPx, fontSizePx * 16 + 30);
            GUI.Box(rect, GUIContent.none, _boxStyle);

            GUILayout.BeginArea(new Rect(rect.x + 10, rect.y + 8, rect.width - 20, rect.height - 16));
            Line("発勁ラボブレイカー Unity Bridge");
            Line($"Receiver     : {OkNg(sender.ReceiverReady)}  ({sender.ReceiverStatus})");
            Line($"Avatar       : {OkNg(sender.AvatarReady)}");
            Line($"RightHand    : {OkNg(sender.RightHandReady)}");
            // 重要な座標は上の方に置いて切れないようにする。
            Vector3 p = sender.LastRightHand;
            Line($"  pos        : x={p.x:0.00} y={p.y:0.00} z={p.z:0.00}");
            Line($"LeftHand     : {OkNg(sender.LeftHandReady)}");
            Vector3 lp = sender.LastLeftHand;
            Line($"  pos        : x={lp.x:0.00} y={lp.y:0.00} z={lp.z:0.00}");
            Line($"Send Hz      : {sender.MeasuredSendHz:0.0} Hz");
            Line($"Heartbeat Hz : {sender.MeasuredHeartbeatHz:0.0} Hz");
            Line($"Target       : {sender.TargetEndpoint}");
            Line($"Session      : {sender.SessionId}");
            Line($"Last Seq     : {sender.LastSeq}");
            GUILayout.EndArea();
        }

        private void Line(string text)
        {
            GUILayout.Label(text, _labelStyle);
        }

        private static string OkNg(bool ok) => ok ? "OK" : "NG";

        private void EnsureStyles()
        {
            if (_labelStyle == null)
            {
                _labelStyle = new GUIStyle(GUI.skin.label)
                {
                    fontSize = fontSizePx,
                    richText = false
                };
                _labelStyle.normal.textColor = Color.white;
            }

            if (_boxStyle == null)
            {
                _boxStyle = new GUIStyle(GUI.skin.box);
                var tex = new Texture2D(1, 1);
                tex.SetPixel(0, 0, new Color(0f, 0f, 0f, 0.7f));
                tex.Apply();
                _boxStyle.normal.background = tex;
            }
        }
    }
}
