# @fanza_poll_lab アカウント紹介動画プロンプト
## AI会議 最終決定版（2026/04/13）
## 会議ID: meeting-1776109916485（5ラウンド完了）

---

## 動画導入の段階

| フェーズ | 時期 | 使う案 | 対象アカウント |
|---------|------|--------|--------------|
| Phase-0.5 先行テスト | 最初 | 案① | @fanza_poll_lab のみ |
| Phase-1 A/Bテスト | 48h監視OK後 | 案② | @fanza_poll_lab のみ |
| Phase-1 拡張 | フォロワー500人以降 | 案③ | 両アカウント |

---

## 共通ネガティブプロンプト

```
nsfw, nudity, explicit, real photo, 3D render, watermark, subtitle, clutter, flicker, motion blur, dark lighting
```

## Canva後付けテキスト（共通）

- 上部: 「毎日2択投票🗳️」
- 下部: 「@fanza_poll_lab で参加しよう！」

---

## 【案①】Minimal Vote Drop（先行テスト用・最優先）

### コンセプト
ピンク髪の白衣マスコットが投票箱を持って立ち、ネオンピンクとダークネイビーの投票用紙が上からひらひら落ちて箱に入る。女の子が微笑んでシーンがリセット、無限ループ。

### 推奨尺
6秒

### プロンプト
```
looping 6-second 2D anime style video, neon pink (#ff2d78) and dark navy (#1a1a2e) palette, cute pink-haired anime girl wearing a white lab coat stands centre holding a ballot box, two rectangular paper slips (one neon pink, one dark navy) fall gently from the top and drop into the box, girl smiles, scene resets seamlessly for an infinite loop, flat clean background, no text, SFW only
```

### ネガティブプロンプト
```
nsfw, nudity, explicit, real photo, 3D render, watermark, subtitle, clutter, graph, chart, pop-up, flicker, motion blur, dark lighting
```

### テスト条件
- 48h監視KPI: SBI=0 & IP≥50 & 動画再生≥30回
- 全てクリアで案②に進む、未達なら静止画に戻す

---

## 【案②】Vote Slip → Bar Graph Pop（Phase-1 A/Bテスト用）

### コンセプト
案①の発展版。投票用紙が箱に入った後、箱の上に小さな2色棒グラフがポンと表示される。女の子がウインク、グラフがフェードアウトしてループ。「投票→結果が見える」の体験を動画で表現。

### 推奨尺
7秒

### プロンプト
```
looping 7-second 2D anime video, neon pink (#ff2d78) and dark navy (#1a1a2e) colour scheme, pink-haired anime girl in a white lab coat presents a ballot box at centre, two coloured slips swirl once in mid-air and drop into the box, a small two-bar chart (pink vs navy) pops up above the box, girl winks, chart fades as scene returns to first frame for a smooth infinite loop, simple flat background, no text, SFW
```

### ネガティブプロンプト
```
nsfw, nudity, explicit, real photo, 3D, watermark, subtitle, complex background, shaky camera, low fps, strobe, dark frame
```

### テスト条件
- Phase-1移行後にPoll投稿で「動画 vs 画像」A/Bテスト
- KPI: EV5≥5 & SBI=0

---

## 【案③】Paper Rain & Pie Chart Loop（拡張用）

### コンセプト
ダークネイビーの背景にネオンピンクとネイビーの投票用紙が雨のように降り注ぐ。白衣のマスコット女の子が投票箱を頭上に掲げてくるりと回転、用紙が箱に吸い込まれる。2色の円グラフが現れて1回転→溶けるように消える。紙の雨が途切れなく続いてシームレスループ。

### 推奨尺
7秒

### プロンプト
```
smooth 7-second looping animation, dark navy background (#1a1a2e), gentle rain of neon pink and dark navy paper slips, pink-haired anime girl in a white lab coat twirls holding a ballot box above her head, slips funnel into the box, a simple two-slice pie chart (pink and navy) appears above, rotates once then dissolves, rain continues seamlessly, flat cel-shaded style, no text, SFW only
```

### ネガティブプロンプト
```
nsfw, nude, explicit, photorealistic, 3D, watermark, subtitles, jitter, flashing lights, cluttered scenery, motion blur
```

### 備考
- 技術的に最も難易度が高い（成功率30%程度）
- フォロワー500人以上到達後の拡張施策として位置づけ
- 失敗した場合は案①or②にフォールバック

---

## 運用手順

### Step 1: 案①でテスト
1. Nanobanana2で案①のプロンプトを入力して動画生成
2. Canvaで上部「毎日2択投票🗳️」下部「@fanza_poll_lab で参加しよう！」を追加
3. @fanza_poll_labの固定ツイートとして投稿
4. 48時間監視（SBI=0 & IP≥50 & 再生≥30回）

### Step 2: テストOKなら案②も生成
1. 案①のKPIクリアを確認
2. 案②を生成し、Poll投稿に動画を添付して投稿
3. 画像Poll vs 動画Pollの効果を比較

### Step 3: 拡張
1. フォロワー500人到達後に案③を試す
2. 成功したら固定ツイートを案③に差し替え
