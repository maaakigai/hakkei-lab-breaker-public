# 7分発表原稿（日本語版）— 発勁ラボブレイカー

---

## 1. 導入（約45秒）

- 皆さん、こんにちは。研究、就活、締め切り——順調ですか。
- 順調な人、おめでとうございます。
- 順調じゃない人、大丈夫です。この発表はそういう人のために作りました。
- 順調じゃない人は、たぶん頭のどこかで「もう全部壊したい」って思ってますよね。わかります。
- 中間発表で約束しましたね。「全部壊しましょう」と。
- 今日はその約束を、実際に守れているところをお見せします。

---

## 2. これはどういうゲームか（約90秒・面白さ重視）

- タイトルは「UBI-Lab Break Simulator」。
- ルールは単純です。センサーを利き手に着けて、思いっきり振りかぶって、一発だけパンチを打つ。
- それだけで、目の前の研究室が壊れます。しかも自分のタメと拳の強さに応じて、壊れ方がちゃんと変わる。軽くタメたら棚がちょっと崩れる程度、全力なら部屋ごと吹き飛びます。
- 動画が終わると、追い打ちが来ます。「破損見積書」。壊した備品を一つ一つ品目と金額で並べて、合計金額を叩きつけてきます。
- この見積書の内容も実際に研究室にあるものにしてリアリティを出しています、研究室のハイエンドPCとか。
- パンチ一発で数百万、数千万円の請求書が出るのは、ちょっと笑えるくらい理不尽です。
- そしてランクが出ます。E〜Sランク。
- Sランクでは、研究室の破壊映像と最上位の結果演出を楽しめます。
- 頑張って作ったので、ぜひSランクを目指してください。
- 最後にランキングボードに名前が載ります。次の人が「自分はもっと壊せる」と思って挑戦したくなる作りです。

---

## 3. 遊び方（約58秒・聞いたらすぐ遊べるように）

- 遊び方はこの4ステップだけです。
1. スマホでQRコードを読んで、名前を登録する。
2. センサーを利き手に着けて、構える。
3. 腕を振って「タメ」を作る。ゲージが伸びます。溜めすぎるとガラスにヒビが入る演出と、割れる音が鳴ります。
- チャージ中の動きは自由です。縦に振っても、横に振っても、腕を回しても構いません。自分に合った動かし方を見つけてください。
4. タメが十分たまったら、一発だけパンチを打つ。それで威力が確定します。
- 難しい操作は一切ありません。「溜めて、一発打つ」。これだけです。この後、実際にやってみたい人はこの流れのまま遊べます。

---

## 4. 技術の話（約112秒）

- センサーは、体に着けるIMU——慣性計測ユニット——1個だけ。利き手の手首につけて、BLE、Bluetooth Low Energyで直接データを受け取っています。
- 実は最初は、体全体の動きをモーションキャプチャで検知して必殺技を出したいと思っていました。かめはめ波とか、虚式茈とか、解とか、領域展開とか。
- ただそれには、mocopiセンサーを体中に着ける必要があり、一人あたりの準備時間が伸びてしまいます。
- 僕はここに来た人全員に遊んでほしかったので、センサー1個で完結する今の形にしました。
- そのセンサーの生データから、ノイズフロアを除去しながら「どれだけ溜めたか」「どれだけ強く打ったか」の2つの数値をリアルタイムで計算しています。
- タメは、手首の回転角の積算です。パンチの強さは、角速度のピーク値です。実は位置でも加速度でもなく、クォータニオンの差分から求めた角速度だけを見ています。
- その実測データをもとに、ロジスティック関数で飽和させたカーブでスコアを出しています。適当な数式ではなく、実測に基づいた計算です。
- 破壊動画は動画生成AI——拡散モデル——で作りました。同じカメラアングルで、威力ごとに壊れ方の強度を変えて何本も作っています。

---

## 5. デモ（約90秒）

- 実際にやってみます。実況しながら進めます。
1. スマホでQRを読んで、名前を登録します。
2. センサーの反応を確認します。
3. 構えて、腕を振ってタメます。ゲージが伸びていくのを見てください。
4. 一発、打ちます。
5. 破壊動画が流れます。
6. 見積書の金額がカウントアップしていきます。
7. ランクが出ます。ランキングボードで自分の順位も見てみます。

---

## 6. 締め（約30秒）

- センサー1個、パンチ1発、とんでもない金額の請求書。
- 中間発表で「壊しましょう」と言いました。今、目の前で本当に壊れました。
- この後は皆さんの番です。実際に遊べます。次は誰がやりますか。

---

(イントロダクション)
- Hello, everyone. How is your research? How is your job hunting? How are your deadlines?
- If things are good for you, congratulations.
- If things are not good, don't worry. This talk is for you too.
- Maybe you want to break everything right now. I understand that.
- At the mid-term talk, I made a promise. I said, "Let's break everything."
- Today, I will show you that I kept my promise.

(ゲームのタイトル画面が欲しい．センサの装着図，腕を振る図，パンチする図を矢印で示しながら目線を誘導)
- This project is called "UBI-Lab Break Simulator."
- The rule is simple. Put a sensor on your strong hand, swing your arm back, then throw one punch.


(破壊動画のスクショ．破壊規模が小さいやつと大きいやつを並べる．)
- That one punch destroys the lab in front of you. The damage depends on your power and your punch. A small punch breaks a few things. A very strong punch destroys the whole room.

(リザルト画面スクショ)
- After the video, you see something funny: a "damage report" that lists every broken item and its price.
- The items are real, like an expensive computer from our lab.
- One punch can cost millions of yen. That is a funny and unfair idea.

(ランクE～Sの図．Sの演出は?で伏せておく)
- Then you get a rank, from E to S.
- S rank shows the strongest lab-destruction result in the public version.
- I worked hard on this game. Please try to reach S rank today.

(ランキングボードのスクショ)
- Finally, your name goes on the ranking board, so the next player wants to break even more.- You can play this game in four easy steps.

(ゲームのスクショ)
1. Scan the QR code with your phone. Enter your name.2. Put the sensor on your strong hand. Get ready.
3. Swing your arm to build power. Watch the gauge grow. If you build too much power, the screen glass cracks, and you will hear a crack sound.
- You can move your arm any way you like: up and down, side to side, or in a circle.
4. When you have enough power, throw one punch. And your power is now decided.
- There are no hard controls. Just "build power, then punch." That's all.

(センサ: mocopiと通信の説明図)
- The sensor is one IMU, an inertial measurement unit, worn on your strong wrist. It sends data to the computer over BLE, Bluetooth Low Energy.

(当初の方針，各アニメモーションのイラスト)
- At first, I wanted to track your whole body with motion capture, for special moves like Kamehameha, Hollow Purple, Dismantle, or Domain Expansion.
- But that needs many sensors on your body, so each player needs more time.
- I want everyone here to get a chance to play, so I chose this simple design.

(取得データの説明，数式や図，身体のイラストを交えつつわかりやすく)
- The raw sensor data is a quaternion, which describes orientation. The computer removes noise and calculates your power and your punch strength in real time.
- Power is the total turning angle of your wrist. Punch strength is the peak angular velocity 
— your fastest turning speed. It's not position or acceleration, only how your wrist's orientation changes.

(comfy aiのスクショやgeminiのイラスト)
- The destruction videos are made by a video generation AI, a diffusion model. We use the same camera angle every time, but the damage level changes with your power.

## 5. Demo

- Now, let's try it. I will talk while I play.
1. Scan the QR code with my phone. Enter my name.
2. Check the sensor.
3. Get ready, then swing my arm to build power. Watch the gauge grow.
4. Throw one punch.
5. The destruction video plays.
6. The damage report price counts up.
7. The rank appears. Let's also check the ranking board.

## 6. Closing

- One sensor, one punch, a crazy big bill.
- At the mid-term talk, I said, "Let's break everything." Now, in front of you, it really broke.
- Now it's your turn. You can play this after the talk. Who wants to go next?
