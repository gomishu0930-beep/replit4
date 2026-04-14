# 画像・動画生成ルールブック（会議参照用）
## 最終更新: 2026/04/14
## 適用アカウント: @ero_senpai1

---

## 1. 可愛さスコアリング基準（橋本環奈 = 100点）

### スコア定義
橋本環奈の顔面偏差値を「100点満点」の基準とし、生成画像の可愛さを以下の項目でスコアリングする。
投稿に使用する画像は **スコア85以上** を合格ラインとする。

### 採点項目（各10点満点 × 10項目 = 100点）

| # | 項目 | 橋本環奈の特徴（=10点） | プロンプト対応 |
|---|------|----------------------|--------------|
| 1 | 顔の丸み | 丸顔、頬のふっくら感 | `round chubby cheeks, baby face` |
| 2 | 目の大きさ・輝き | 大きな丸い瞳、キラキラ感、涙袋 | `large round sparkling eyes with aegyo sal` |
| 3 | 鼻の形 | 小さく丸い愛嬌のある鼻 | `small cute button nose` |
| 4 | 口元の可愛さ | 小さめの口、口角が上がった微笑み | `gentle smile, mouth corners slightly upturned` |
| 5 | 肌の透明感 | 陶器のような透明肌だが毛穴も見える自然さ | `warm youthful glow, natural skin texture with visible pores` |
| 6 | 髪の質感・ツヤ | 天使の輪、サラサラ感、自然なおくれ毛 | `soft waves, natural stray hair wisps` |
| 7 | 表情の自然さ | 作り込みすぎない、ナチュラルな可愛さ | `gentle smile, warm innocent gaze` |
| 8 | 全体バランス | 顔パーツの配置バランス、黄金比 | `soft rounded facial features` |
| 9 | 写真のリアル感 | 実在感、AIっぽさの無さ | `RAW photo, film grain, visible pores, fine peach fuzz` |
| 10 | オーラ・雰囲気 | 親しみやすさと華やかさの共存 | `warm youthful glow, light blush, subtle glossy lips` |

### スコア別判定

| スコア | 判定 | アクション |
|--------|------|-----------|
| 90〜100 | 神画像 | 即採用。固定ツイートやアフィリ投稿の画像に優先使用 |
| 85〜89 | 合格 | 通常投稿に使用OK |
| 75〜84 | 惜しい | 再生成（プロンプト微調整で改善を試みる） |
| 〜74 | 不合格 | 使用禁止。プロンプト自体を見直す |

### スコアが低い場合のチェックリスト

- [ ] `RAW photo` が冒頭にあるか？
- [ ] `baby face, round chubby cheeks` が入っているか？
- [ ] `aegyo sal`（涙袋）を指定しているか？
- [ ] `natural skin texture with visible pores` でリアル感を出しているか？
- [ ] `fine peach fuzz` で産毛の質感を追加しているか？
- [ ] ネガティブに `plastic skin, airbrushed skin, overly smooth skin` を入れているか？
- [ ] `shot on Sony A7IV 85mm f/1.4` でカメラの実在感を出しているか？
- [ ] `mature face, sharp jawline` をネガティブで除外しているか？

---

## 2. 共通顔プロンプト（全画像・全動画のベース）

```
RAW photo, cute japanese idol girl, baby face, round chubby cheeks, small cute button nose, large round sparkling eyes with aegyo sal, soft rounded facial features, gentle smile, mouth corners slightly upturned, see-through bangs, straight medium-length dark brown hair, delicate collarbone highlight, warm youthful glow, subtle glossy lips, light blush, natural skin texture with visible pores, fine peach fuzz on cheeks, subsurface scattering on ear tips, tiny beauty mark near jawline, natural stray hair wisps
```

---

## 3. リアリティ強化キーワード（必須）

| カテゴリ | キーワード | 効果 |
|---------|-----------|------|
| 肌質感 | `natural skin texture with visible pores` | 毛穴が見えるリアルな肌 |
| 産毛 | `fine peach fuzz on cheeks` | 頬の産毛で実在感UP |
| 光の透過 | `subsurface scattering on ear tips` | 耳たぶが光に透ける自然現象 |
| 不完全さ | `tiny beauty mark near jawline` | 小さなほくろで完璧すぎない顔に |
| 髪の自然さ | `natural stray hair wisps` | おくれ毛・アホ毛で自然な髪に |
| カメラ | `shot on Sony A7IV 85mm f/1.4` | 実在するカメラ・レンズで撮った感 |
| フィルム | `film grain` | デジタル臭さを軽減 |
| 空気感 | `volumetric haze` | 空間に漂う光の粒子感 |
| レンズ | `anamorphic lens flare`（動画のみ） | 映画的なレンズフレア |

---

## 4. 共通ネガティブプロンプト

### 写真用
```
nude, naked, topless, exposed nipple, exposed genitalia, spread legs, sex act, pornographic, cartoon, anime, 3D render, CGI, digital art, illustration, painting, watermark, text, letters, words, deformed hands, extra fingers, blurry face, asymmetric eyes, crooked nose, oversized mouth, plastic skin, airbrushed skin, overly smooth skin, wax figure, mannequin, deformed jawline, mature face, sharp jawline, gaunt cheeks, harsh shadows, overexposed, underexposed
```

### 動画用（写真用＋動画固有NG）
```
nude, naked, topless, exposed nipple, genitalia, sex act, pornographic, cartoon, anime, 3D render, CGI, digital art, illustration, watermark, subtitle, text, clutter, flicker, motion blur, dark lighting, plastic skin, airbrushed skin, overly smooth skin, wax figure, mannequin, deformed hands, extra fingers, blurry face, asymmetric eyes, crooked nose, oversized mouth, deformed jawline, mature face, sharp jawline, gaunt cheeks, harsh shadows, overexposed, underexposed
```

---

## 5. 構図ルール

### 単体構図（A, F, G）
- 上半身ショット（`upper body shot`）
- カメラ目線（`looking at the camera` / `warm innocent gaze`）
- 背景: ダークネイビー(#1a1a2e) + ボケ
- アクセント: ネオンピンク(#ff2d78) リムライト

### VS構図（B, C, D, E）
- 画面を斜め分割（`VS split composition with diagonal light divider`）
- 左側 = ネオンピンク(#ff2d78) ライティング → 選択肢①
- 右側 = ダークネイビー(#1a1a2e) ライティング → 選択肢②
- 中央 = VS光エフェクト（`VS light burst effect`）
- Girl A = dark brown hair / Girl B = light brown hair（髪色で識別）
- 両者カメラ目線

### 動画構図（案①②③）
- 中央に人物＋投票箱
- ネオンピンク＋ダークネイビーの投票用紙が落下
- ループ設計（シームレスに最初に戻る）

---

## 6. 配色ルール

| 要素 | カラーコード | 用途 |
|------|-------------|------|
| ネオンピンク | #ff2d78 | リムライト、VS左側、投票用紙A |
| ダークネイビー | #1a1a2e | 背景、VS右側、投票用紙B |

---

## 7. 服装ルール

### 許可範囲
- 鎖骨・肩・二の腕まで見せてOK
- Vネック・ボタン開き1つまではOK
- マスコット衣装: 白衣 + 黒キャミソール/黒トップ

### 禁止事項
- ヌード・下着丸出し
- 性的ポーズ
- 実在人物の顔指定

---

## 8. 投稿別衣装・表情マッピング

| 投稿 | 表情 | 衣装 | 特殊要素 |
|------|------|------|---------|
| A 固定 | gentle smile | 白衣+黒キャミ | 投票箱を持つ |
| B 巨乳vs美乳 | confident / refined | Vニット vs シルクブラウス | 腕組み vs 腰に手 |
| C 清楚vsギャル | shy / playful smirk | レースブラウス vs オフショルクロップトップ | リボン vs ネックレス重ね |
| D OLvs幼なじみ | confident / shy blushing | チャコールブレザー vs クリームカーディガン | メガネ vs 肩出し |
| E 制服vsナース | playful wink / gentle caring | セーラー服 vs ナース服 | ツインブレイド vs 聴診器 |
| F ネタ募集 | curious excited | 白衣+黒トップ | デスクに座り、頬杖 |
| G アフィリ | excited happy | 白衣ゆるがけ | ピンクギフトバッグ |

---

## 9. 画像生成フロー

```
1. 投稿タイプ確認（単体 or VS）
2. 共通顔プロンプト + リアリティ強化キーワード + 投稿別要素を結合
3. ネガティブプロンプトを追加
4. Nanobanana2で生成
5. 橋本環奈スコアで採点（85点以上で合格）
6. 不合格 → チェックリスト確認 → プロンプト微調整 → 再生成
7. 合格 → 投稿用として保存
```

---

## 10. 動画生成フロー

```
1. フェーズ確認（Phase-0.5 → 案①のみ / Phase-1 → 案② / 500人超 → 案③）
2. 共通顔プロンプト + リアリティ強化 + 動画固有要素を結合
3. 動画用ネガティブプロンプトを追加
4. Nanobanana2で生成（動画モード）
5. Canvaでテキストオーバーレイ追加
6. 48h監視（SBI=0 & IP≥50 & 再生≥30）
7. KPIクリアで次のフェーズへ
```

---

## 11. 会議での画像議論フォーマット

会議で画像プロンプトを議論する際は以下のフォーマットを使用:

```
【画像議論】
- 対象投稿: [A〜G / 動画①〜③]
- 現行スコア: [橋本環奈基準 XX/100]
- 改善ポイント: [具体的な項目]
- 提案プロンプト変更: [変更前 → 変更後]
- 期待スコア改善: [+XX点]
```
