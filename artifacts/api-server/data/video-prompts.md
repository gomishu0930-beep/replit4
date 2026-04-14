# @fanza_poll_lab アカウント紹介動画プロンプト
## OODA会議 最終決定版（2026/04/14）
## 会議ID: meeting-1776132427236（3ラウンド完了）
## スタイル: 乃木坂46/フルーツジッパー系アイドル的可愛さ（たぬき顔・baby face・リアル寄り）
## リアリティ強化: RAW photo style / 肌質感 / 自然な不完全さ / アナモルフィックレンズ

---

## 動画導入の段階

| フェーズ | 時期 | 使う案 | 対象アカウント |
|---------|------|--------|--------------|
| Phase-0.5 先行テスト | 最初 | 案① | @fanza_poll_lab のみ |
| Phase-1 A/Bテスト | 48h監視OK後 | 案② | @fanza_poll_lab のみ |
| Phase-1 拡張 | フォロワー500人以降 | 案③ | 両アカウント |

---

## 顔の基本プロンプト（全動画で共通使用・写真と統一）

```
RAW photo, cute japanese idol girl, baby face, round chubby cheeks, small cute button nose, large round sparkling eyes with aegyo sal, soft rounded facial features, gentle smile, mouth corners slightly upturned, see-through bangs, straight medium-length dark brown hair, delicate collarbone highlight, warm youthful glow, subtle glossy lips, light blush, natural skin texture with visible pores, fine peach fuzz on cheeks, subsurface scattering on ear tips, tiny beauty mark near jawline, natural stray hair wisps
```

## 共通ネガティブプロンプト

```
nude, naked, topless, exposed nipple, genitalia, sex act, pornographic, cartoon, anime, 3D render, CGI, digital art, illustration, watermark, subtitle, text, clutter, flicker, motion blur, dark lighting, plastic skin, airbrushed skin, overly smooth skin, wax figure, mannequin, deformed hands, extra fingers, blurry face, asymmetric eyes, crooked nose, oversized mouth, deformed jawline, mature face, sharp jawline, gaunt cheeks, harsh shadows, overexposed, underexposed
```

## Canva後付けテキスト（共通）

- 上部: 「毎日2択投票🗳️」
- 下部: 「@fanza_poll_lab で参加しよう！」

---

## 【案①】Minimal Vote Drop（先行テスト用・最優先）

### コンセプト
アイドル的可愛さの黒髪美女が白衣を羽織って投票箱を持ち、ネオンピンクとダークネイビーの投票用紙がひらひら落ちて箱に入る。彼女がにっこりウインク、シーンがリセットして無限ループ。

### 推奨尺
6秒

### プロンプト
```
looping 6-second cinematic video, RAW photo style, photorealistic, cute japanese idol girl, baby face, round chubby cheeks, small cute button nose, large round sparkling eyes with aegyo sal, soft rounded facial features, gentle smile, mouth corners slightly upturned, see-through bangs, long flowing dark brown hair with soft waves, delicate collarbone highlight, warm youthful glow, subtle glossy lips, light blush, natural skin texture with visible pores, fine peach fuzz, subsurface scattering on ear tips, natural stray hair wisps, wearing an open white lab coat over a black fitted camisole, stands at centre holding a stylish ballot box, two rectangular paper slips (one neon pink #ff2d78, one dark navy #1a1a2e) fall gently from above and drop into the box, girl gives a cute wink and smile, neon pink rim lighting from left side, dark navy background with soft bokeh, anamorphic lens flare, cinematic shallow depth of field, volumetric haze, scene resets seamlessly for an infinite loop, fully clothed, no text, SFW
```

### ネガティブプロンプト
```
nude, naked, topless, exposed nipple, genitalia, sex act, pornographic, cartoon, anime, 3D render, CGI, digital art, illustration, watermark, subtitle, text, clutter, graph, chart, pop-up, flicker, motion blur, dark lighting, plastic skin, airbrushed skin, overly smooth skin, wax figure, mannequin, deformed hands, extra fingers, blurry face, asymmetric eyes, crooked nose, oversized mouth, deformed jawline, mature face, sharp jawline, gaunt cheeks, harsh shadows, overexposed, underexposed
```

### テスト条件
- 48h監視KPI: SBI=0 & IP≥50 & 動画再生≥30回
- 全てクリアで案②に進む、未達なら静止画に戻す

---

## 【案②】Vote Slip → Bar Graph Pop（Phase-1 A/Bテスト用）

### コンセプト
案①の発展版。投票用紙が箱に入った後、箱の上にネオンピンクとネイビーの棒グラフがポンと浮かび上がる。美女が嬉しそうに微笑みグラフがフェードアウトしてループ。

### 推奨尺
7秒

### プロンプト
```
looping 7-second cinematic video, RAW photo style, photorealistic, cute japanese idol girl, baby face, round chubby cheeks, small cute button nose, large round sparkling eyes with aegyo sal, soft rounded facial features, gentle smile, see-through bangs, flowing dark brown hair with highlights, delicate collarbone highlight, warm youthful glow, subtle glossy lips, light blush, natural skin texture with visible pores, fine peach fuzz, subsurface scattering on ear tips, natural stray hair wisps, wearing a white lab coat draped over her shoulders with a cute dark top underneath, presents a ballot box at centre, two coloured slips (neon pink #ff2d78 and dark navy #1a1a2e) swirl once in mid-air and drop into the box, a small two-bar chart (pink vs navy) materializes above the box with a soft glow, girl tilts her head and gives a playful cute wink, chart fades as scene returns to first frame for a smooth infinite loop, neon pink accent lighting, dark navy background with bokeh, anamorphic lens flare, cinematic shallow depth of field, volumetric haze, fully clothed, no text, SFW
```

### ネガティブプロンプト
```
nude, naked, topless, exposed nipple, genitalia, sex act, pornographic, cartoon, anime, 3D render, CGI, digital art, illustration, watermark, subtitle, text, complex background, shaky camera, low fps, strobe, dark frame, plastic skin, airbrushed skin, overly smooth skin, wax figure, mannequin, deformed hands, extra fingers, blurry face, asymmetric eyes, crooked nose, oversized mouth, deformed jawline, mature face, sharp jawline, gaunt cheeks, harsh shadows, overexposed, underexposed
```

### テスト条件
- Phase-1移行後にPoll投稿で「動画 vs 画像」A/Bテスト
- KPI: EV5≥5 & SBI=0

---

## 【案③】Paper Rain & Pie Chart Loop（拡張用）

### コンセプト
ダークネイビーの背景にネオンピンクとネイビーの投票用紙が雨のように降り注ぐ。白衣のアイドル的可愛さの美女が投票箱を胸元に抱えてくるりと回転、用紙が箱に吸い込まれる。2色の円グラフが現れて1回転→溶けるように消えてシームレスループ。

### 推奨尺
7秒

### プロンプト
```
smooth 7-second looping cinematic video, RAW photo style, photorealistic, dark navy background (#1a1a2e), gentle rain of neon pink (#ff2d78) and dark navy paper slips falling like confetti, cute japanese idol girl, baby face, round chubby cheeks, small cute button nose, large round sparkling eyes with aegyo sal, soft rounded facial features, gentle smile, see-through bangs, long dark brown hair flowing in motion, warm youthful glow, subtle glossy lips, light blush, natural skin texture with visible pores, fine peach fuzz, subsurface scattering on ear tips, natural stray hair wisps, wearing a white lab coat that billows softly, holds a ballot box close to her body and twirls gracefully, slips funnel into the box, a simple two-slice pie chart (pink and navy) appears above with a neon glow, rotates once then dissolves into particles, rain continues seamlessly, anamorphic lens flare, cinematic rim lighting, volumetric haze, shallow depth of field, fully clothed, no text, SFW
```

### ネガティブプロンプト
```
nude, naked, topless, exposed nipple, genitalia, sex act, pornographic, cartoon, anime, 3D render, CGI, digital art, illustration, watermark, subtitle, text, jitter, flashing lights, cluttered scenery, motion blur, plastic skin, airbrushed skin, overly smooth skin, wax figure, mannequin, deformed hands, extra fingers, blurry face, asymmetric eyes, crooked nose, oversized mouth, deformed jawline, mature face, sharp jawline, gaunt cheeks, harsh shadows, overexposed, underexposed
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
