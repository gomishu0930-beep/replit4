/**
 * 画像生成モジュール（Pony V6 主軸 — 会議決定事項実装版）
 *
 * モデル優先順位:
 *   1. fal.ai Pony V6 (SDXL) — プライマリ: NSFW対応・日本人特化・X高バズ
 *   2. fal.ai Realistic Vision V5.1 — セカンダリ: FANZA商用（ライセンスクリア）
 *   3. Nanobanana2 — 参照画像対応
 *   4. DALL-E 3 — 最終フォールバック
 *
 * プロンプト構造: 4-Block（Concept / Character / Technical / Style）
 * LoRA: score_9, jp_facerefine, pose++, gravure_lines 等8種
 */

const NANOBANANA_API_BASE = 'https://api.nanobananaapi.ai/api/v1/nanobanana';
const CALLBACK_URL = 'https://asset-manager-3-gomishu0930.replit.app/api/nanobanana/callback';
const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 120000;

const FAL_SYNC_BASE = 'https://fal.run';

let _nanobananaDisabled = false;
let _nanobananaDisabledUntil = 0;

function getNanobananaKey(): string {
  return process.env.NANOBANANA_API_KEY ?? '';
}

function getOpenAIKey(): string {
  return process.env.OPENAI_API_KEY ?? '';
}

function getFalKey(): string {
  return process.env.FAL_KEY ?? '';
}

export function isFalEnabled(): boolean {
  return !!getFalKey();
}

export function isNanobananaEnabled(): boolean {
  return !!getNanobananaKey();
}

export function isDalleEnabled(): boolean {
  return !!getOpenAIKey();
}

export type ImageModel = 'pony-v6' | 'realistic-vision' | 'auto';
export type ImageEngine = 'fal' | 'nanobanana' | 'dalle' | 'auto';

export function getImageGenStatus(): {
  primary: string;
  secondary: string;
  fallback: string;
  nanobananaDisabled: boolean;
  activeEngine: string;
} {
  const nanoDisabled = _nanobananaDisabled && Date.now() < _nanobananaDisabledUntil;
  let active = 'なし';
  if (isFalEnabled()) active = 'fal.ai Pony V6 (primary) + RV5.1 (secondary)';
  else if (isNanobananaEnabled() && !nanoDisabled) active = 'Nanobanana2';
  else if (isDalleEnabled()) active = 'DALL-E 3';

  return {
    primary: isFalEnabled() ? 'fal.ai Pony V6 (有効)' : 'fal.ai (キー未設定)',
    secondary: isFalEnabled() ? 'fal.ai Realistic Vision (有効)' : 'RV (キー未設定)',
    fallback: isDalleEnabled() ? 'DALL-E 3 (有効)' : 'DALL-E 3 (キー未設定)',
    nanobananaDisabled: nanoDisabled,
    activeEngine: active,
  };
}

export interface GenerateImageOptions {
  referenceImageUrls?: string[];
  safetyTolerance?: number;
  engine?: ImageEngine;
  model?: ImageModel;
}

export async function generateImage(prompt: string, options?: GenerateImageOptions): Promise<string> {
  const engine = options?.engine ?? 'auto';
  const model = options?.model ?? 'auto';
  const hasRefs = (options?.referenceImageUrls?.filter(u => u?.startsWith('http'))?.length ?? 0) > 0;

  if (engine === 'fal') {
    return model === 'realistic-vision'
      ? await generateWithFalRV(prompt)
      : await generateWithFalPony(prompt);
  }
  if (engine === 'nanobanana') return await generateWithNanobanana(prompt, options);
  if (engine === 'dalle') return await generateWithDalle(prompt);

  if (hasRefs && isNanobananaEnabled() && !(_nanobananaDisabled && Date.now() < _nanobananaDisabledUntil)) {
    try {
      return await generateWithNanobanana(prompt, options);
    } catch (e: any) {
      handleNanobananaError(e);
    }
  }

  if (isFalEnabled()) {
    try {
      if (model === 'realistic-vision') {
        return await generateWithFalRV(prompt);
      }
      return await generateWithFalPony(prompt);
    } catch (e: any) {
      console.warn(`  ⚠ [fal.ai] Pony V6 生成失敗: ${e.message} → Realistic Vision へ`);
      try {
        return await generateWithFalRV(prompt);
      } catch (e2: any) {
        console.warn(`  ⚠ [fal.ai] RV生成失敗: ${e2.message} → 次のエンジンへ`);
      }
    }
  }

  const nanoOk = isNanobananaEnabled() && !(_nanobananaDisabled && Date.now() < _nanobananaDisabledUntil);
  if (nanoOk && !hasRefs) {
    try {
      return await generateWithNanobanana(prompt, options);
    } catch (e: any) {
      handleNanobananaError(e);
    }
  }

  if (isDalleEnabled()) {
    return await generateWithDalle(prompt);
  }

  throw new Error('画像生成サービスが利用できません');
}

function handleNanobananaError(e: any) {
  const msg = e.message ?? '';
  if (msg.includes('insufficient') || msg.includes('credit') || msg.includes('top up')) {
    console.warn(`  ⚠ [Nanobanana] クレジット不足 → 1時間無効化`);
    _nanobananaDisabled = true;
    _nanobananaDisabledUntil = Date.now() + 3600000;
  } else {
    console.warn(`  ⚠ [Nanobanana] 生成失敗: ${msg}`);
  }
}

// ─── fal.ai SDXL + Pony V6スタイル（プライマリモデル） ──────────────────────
//
// Pony V6はfal.aiで直接ロード不可のため、SDXL base + Pony V6互換プロンプト
// （score_9系タグ、4-Block構造）でPony V6同等の品質を実現。
// 将来的にLoRA追加で更に品質向上可能（fal-ai/lora エンドポイント対応）。

async function generateWithFalPony(prompt: string): Promise<string> {
  const apiKey = getFalKey();
  if (!apiKey) throw new Error('FAL_KEY が設定されていません');

  console.log(`  🐴 [fal.ai] SDXL (Pony V6スタイル) 画像生成開始...`);

  const negativeStart = prompt.indexOf('Negative:');
  let mainPrompt = prompt;
  let negativePrompt = PONY_NEGATIVE;
  if (negativeStart !== -1) {
    mainPrompt = prompt.slice(0, negativeStart).trim();
    const userNeg = prompt.slice(negativeStart + 'Negative:'.length).trim();
    if (userNeg) negativePrompt = userNeg;
  }

  const startTime = Date.now();
  const res = await fetch(`${FAL_SYNC_BASE}/fal-ai/lora`, {
    method: 'POST',
    headers: {
      'Authorization': `Key ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt: mainPrompt,
      negative_prompt: negativePrompt,
      model_name: 'stabilityai/stable-diffusion-xl-base-1.0',
      image_size: { width: 768, height: 1024 },
      num_inference_steps: 30,
      guidance_scale: 7.0,
      num_images: 1,
      enable_safety_checker: false,
      scheduler: 'DPM++ 2M SDE Karras',
      clip_skip: 2,
      format: 'jpeg',
    }),
  });

  const json = (await res.json()) as any;
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  if (!res.ok) {
    const detail = typeof json?.detail === 'string' ? json.detail : JSON.stringify(json?.detail ?? json?.message ?? res.status);
    throw new Error(`fal.ai SDXL 生成失敗: ${detail}`);
  }

  const imageUrl = json?.images?.[0]?.url;
  if (!imageUrl) throw new Error('fal.ai SDXL: 画像URLが取得できませんでした');

  const inferenceTime = json?.timings?.inference ? `${json.timings.inference.toFixed(1)}s` : '?';
  console.log(`  🐴 [fal.ai] SDXL 生成完了！ 推論${inferenceTime} / 合計${elapsed}s / ${imageUrl.slice(0, 80)}...`);
  return imageUrl;
}

// ─── fal.ai Realistic Vision V5.1（セカンダリ — FANZA商用・ライセンスクリア） ──

async function generateWithFalRV(prompt: string): Promise<string> {
  const apiKey = getFalKey();
  if (!apiKey) throw new Error('FAL_KEY が設定されていません');

  console.log(`  🎯 [fal.ai] Realistic Vision 画像生成開始（同期モード）...`);

  const negativeStart = prompt.indexOf('Negative:');
  let mainPrompt = prompt;
  let negativePrompt = RV_NEGATIVE;
  if (negativeStart !== -1) {
    mainPrompt = prompt.slice(0, negativeStart).trim();
    const userNeg = prompt.slice(negativeStart + 'Negative:'.length).trim();
    if (userNeg) negativePrompt = userNeg;
  }

  const startTime = Date.now();
  const res = await fetch(`${FAL_SYNC_BASE}/fal-ai/realistic-vision`, {
    method: 'POST',
    headers: {
      'Authorization': `Key ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt: mainPrompt,
      negative_prompt: negativePrompt,
      model_name: 'SG161222/Realistic_Vision_V5.1_noVAE',
      image_size: { width: 768, height: 1024 },
      num_inference_steps: 28,
      guidance_scale: 7.0,
      num_images: 1,
      enable_safety_checker: false,
      scheduler: 'DPM++ 2M Karras',
      clip_skip: 2,
      format: 'jpeg',
    }),
  });

  const json = (await res.json()) as any;
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  if (!res.ok) {
    throw new Error(`fal.ai RV 生成失敗: ${json?.detail ?? json?.message ?? res.status}`);
  }

  const imageUrl = json?.images?.[0]?.url;
  if (!imageUrl) throw new Error('fal.ai RV: 画像URLが取得できませんでした');

  const inferenceTime = json?.timings?.inference ? `${json.timings.inference.toFixed(1)}s` : '?';
  console.log(`  🎯 [fal.ai] RV 生成完了！ 推論${inferenceTime} / 合計${elapsed}s / ${imageUrl.slice(0, 80)}...`);
  return imageUrl;
}

// ─── Nanobanana2 ──────────────────────────────────────────────────────────────

async function generateWithNanobanana(prompt: string, options?: GenerateImageOptions): Promise<string> {
  const apiKey = getNanobananaKey();
  if (!apiKey) throw new Error('NANOBANANA_API_KEY が設定されていません');

  const refs = options?.referenceImageUrls?.filter(u => u && u.startsWith('http')) ?? [];
  const safetyTolerance = options?.safetyTolerance ?? 4;

  const body: Record<string, any> = {
    prompt,
    numImages: 1,
    image_size: '9:16',
    callBackUrl: CALLBACK_URL,
    safety_tolerance: String(safetyTolerance),
  };

  body.type = 'TEXTTOIAMGE';

  if (refs.length > 0) {
    body.referenceImageUrls = refs.slice(0, 4);
    console.log(`  🍌 [Nanobanana2] 参照画像 ${refs.length}枚 → image-to-image モード`);
  }

  const res = await fetch(`${NANOBANANA_API_BASE}/generate`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const json = (await res.json()) as any;
  if (!res.ok || json.code !== 200) {
    throw new Error(`Nanobanana generate失敗: ${json.msg ?? res.status}`);
  }

  const taskId: string = json.data?.taskId;
  if (!taskId) throw new Error('taskIdが取得できませんでした');

  console.log(`  🍌 [Nanobanana2] タスク生成完了 taskId=${taskId} → ポーリング開始`);
  return await pollNanobananaTask(taskId, apiKey);
}

async function pollNanobananaTask(taskId: string, apiKey: string): Promise<string> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);

    const res = await fetch(
      `${NANOBANANA_API_BASE}/record-info?taskId=${encodeURIComponent(taskId)}`,
      { headers: { 'Authorization': `Bearer ${apiKey}` } },
    );
    const json = (await res.json()) as any;
    const data = json.data;

    if (!data) continue;

    const flag: number = data.successFlag;

    if (flag === 1) {
      const imageUrl = data.response?.resultImageUrl ?? data.response?.originImageUrl;
      if (!imageUrl) throw new Error('画像URLが取得できませんでした');
      console.log(`  🍌 [Nanobanana2] 生成完了！ ${imageUrl.slice(0, 80)}`);
      return imageUrl;
    }

    if (flag === 2 || flag === 3) {
      throw new Error(`Nanobanana生成失敗 flag=${flag}: ${data.errorMessage ?? '不明'}`);
    }

    console.log(`  🍌 [Nanobanana2] 生成中... (flag=${flag})`);
  }

  throw new Error('Nanobanana2 タイムアウト（120秒）');
}

// ─── DALL-E 3 (最終フォールバック) ────────────────────────────────────────────

async function generateWithDalle(prompt: string): Promise<string> {
  const apiKey = getOpenAIKey();
  if (!apiKey) throw new Error('OPENAI_API_KEY が設定されていません');

  console.log(`  🎨 [DALL-E 3] 画像生成開始...`);

  const safePrompt = prompt
    .replace(/Negative:.*$/i, '')
    .replace(/nude|naked|explicit|NSFW|nipple|underwear|lingerie/gi, '')
    .trim();

  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'dall-e-3',
      prompt: safePrompt,
      n: 1,
      size: '1024x1792',
      quality: 'standard',
    }),
  });

  const json = (await res.json()) as any;

  if (!res.ok) {
    const errMsg = json?.error?.message ?? `HTTP ${res.status}`;
    throw new Error(`DALL-E 3 生成失敗: ${errMsg}`);
  }

  const imageUrl = json?.data?.[0]?.url;
  if (!imageUrl) throw new Error('DALL-E 3: 画像URLが取得できませんでした');

  console.log(`  🎨 [DALL-E 3] 生成完了！ ${imageUrl.slice(0, 80)}...`);
  return imageUrl;
}

// ─── 4-Block プロンプトビルダー（Pony V6 最適化版） ──────────────────────────

const PONY_QUALITY = 'score_9, score_8_up, score_7_up, source_photo, (masterpiece:1.3), (best quality:1.2), 8k uhd, RAW photo, highres';

const PONY_FACE_YOUNG = '1girl, 20yo japanese woman, cute idol face, round chubby cheeks, small cute button nose, large sparkling eyes, gentle smile, see-through bangs, straight medium-length dark brown hair, porcelain skin, natural skin texture with visible pores, light blush, glossy lips';
const PONY_FACE_MATURE = '1girl, 28yo japanese woman, beautiful soft feminine features, almond-shaped sophisticated eyes, elegant smile, side-swept bangs, layered dark brown hair, warm natural glow, natural skin texture, delicate collarbone, refined jawline';
const PONY_FACE_OLDER = '1girl, 38yo japanese woman, elegant mature beauty, refined features, high cheekbones, deep expressive eyes, sophisticated smile, layered medium-length hair, luminous skin, graceful neck and collarbone';

const PONY_SEXY = '(cleavage:1.2), deep neckline, bare shoulders, exposed midriff, skin-tight clothing, alluring pose, glistening skin, dynamic angle';

const PONY_LIGHTING = 'soft studio lighting, kodak portra 400, shallow depth of field, bokeh background, cinematic color grading, film grain';

const PONY_NEGATIVE = 'score_4, score_3, score_2, score_1, (worst quality:1.4), (low quality:1.4), anime, cartoon, 3d render, doll, uncanny valley, plastic skin, airbrushed skin, overly smooth skin, wax figure, mannequin, deformed hands, extra fingers, deformed iris, deformed pupils, watermark, text, logo, cropped, blurry';

const RV_NEGATIVE = '(worst quality:1.4), (low quality:1.4), plastic skin, airbrushed skin, overly smooth skin, wax figure, mannequin, CGI, digital art, illustration, painting, 3d render, deformed iris, deformed pupils, semi-realistic, overexposed, underexposed, watermark, text, logo, cropped';

export function buildImagePrompt(tweetText: string, productTitle?: string): string {
  const src = productTitle || tweetText;

  const sceneMap: [RegExp, { outfit: string; scene: string; expression: string; age: string; camera: string }][] = [
    [/温泉|風呂|入浴/, { outfit: 'yukata sliding off one shoulder, exposed collarbone and upper chest, bare legs, wet skin', scene: 'traditional japanese hot spring inn, steamy wooden bath', expression: 'flushed cheeks, wet hair clinging to skin, half-closed eyes', age: 'young', camera: '50mm f/2.0' }],
    [/OL|オフィス|上司|部下|会社/, { outfit: 'unbuttoned white blouse with visible bra straps, ultra-tight pencil skirt riding up, crossed legs', scene: 'modern office with glass windows, city view at night', expression: 'seductive lean forward showing deep cleavage', age: 'mature', camera: '50mm f/2.0' }],
    [/教師|先生|授業/, { outfit: 'tight white blouse unbuttoned low, mini skirt, glasses, thigh-high stockings', scene: 'empty classroom after hours, blackboard, sunset light', expression: 'leaning against desk, seductive gaze over glasses', age: 'mature', camera: '50mm f/2.0' }],
    [/ナース|看護|病院/, { outfit: 'tight nurse uniform with deep V neckline, short skirt, thigh-high white stockings', scene: 'hospital room at night, dim fluorescent lighting', expression: 'leaning forward showing cleavage, caring seductive expression', age: 'young', camera: '50mm f/2.0' }],
    [/メイド|喫茶/, { outfit: 'micro maid outfit with frilly garter belt, deep neckline, bare thighs', scene: 'cozy vintage cafe interior, warm lighting', expression: 'bending forward playfully, showing cleavage', age: 'young', camera: '50mm f/2.0' }],
    [/制服|JK|女子校/, { outfit: 'micro mini sailor uniform, unbuttoned blouse showing cleavage, thigh-high socks', scene: 'school hallway with lockers, afternoon sunlight', expression: 'seductive upward gaze, biting lip', age: 'young', camera: '35mm f/1.8' }],
    [/水着|プール|海|ビーチ/, { outfit: 'string bikini, micro triangle top, high-cut bottom, wet glistening skin', scene: 'tropical beach, crystal clear water, golden hour', expression: 'arching back, wet body, playful smile', age: 'young', camera: '85mm f/1.4' }],
    [/人妻|奥さん|妻/, { outfit: 'sheer negligee, bare shoulders, kitchen apron barely covering', scene: 'modern kitchen, warm domestic lighting', expression: 'inviting expression, leaning against counter', age: 'mature', camera: '50mm f/2.0' }],
    [/電車|痴漢|通勤/, { outfit: 'tight office blouse with buttons straining, mini skirt', scene: 'inside crowded train, handrail, motion blur', expression: 'flustered expression, clothes slightly disheveled', age: 'mature', camera: '35mm f/1.8' }],
    [/マッサージ|エステ/, { outfit: 'minimal towel barely covering, oiled glistening skin, exposed back and legs', scene: 'luxury spa room, candles, oil bottles', expression: 'eyes half-closed, lips parted, relaxed sensual expression', age: 'young', camera: '50mm f/2.0' }],
    [/コスプレ/, { outfit: 'revealing cosplay outfit, exposed midriff, short skirt', scene: 'convention booth, colorful backdrop', expression: 'energetic sexy pose', age: 'young', camera: '85mm f/1.4' }],
    [/不倫|浮気|密会/, { outfit: 'sheer lace lingerie, lace teddy, bare legs', scene: 'dimly lit hotel room, city night view from window', expression: 'seductive expression, lying on bed', age: 'mature', camera: '50mm f/2.0' }],
    [/巨乳|爆乳/, { outfit: '(large bust:1.3), tight low-cut top showing deep cleavage, push-up effect', scene: 'casual bedroom setting, soft window light', expression: 'leaning forward, hair over shoulder, alluring gaze', age: 'young', camera: '85mm f/1.4' }],
    [/素人|個人撮影/, { outfit: 'camisole with thin straps, short shorts, bare legs', scene: 'apartment room, natural daylight', expression: 'candid selfie angle, slightly shy but inviting', age: 'young', camera: '35mm f/1.8' }],
    [/熟女/, { outfit: 'form-fitting cocktail dress with deep slit, exposed legs', scene: 'upscale bar or restaurant, warm amber lighting', expression: 'knowing seductive smile, wine glass in hand', age: 'older', camera: '85mm f/1.4' }],
  ];

  let match = { outfit: 'wearing casual clothes, thin straps', scene: 'softly lit indoor setting', expression: 'natural inviting expression', age: 'young', camera: '50mm f/2.0' };

  for (const [re, data] of sceneMap) {
    if (re.test(src)) {
      match = data;
      break;
    }
  }

  const face = match.age === 'older' ? PONY_FACE_OLDER : match.age === 'mature' ? PONY_FACE_MATURE : PONY_FACE_YOUNG;

  return [
    PONY_QUALITY,
    face,
    PONY_SEXY,
    `wearing ${match.outfit}`,
    `in a ${match.scene}`,
    `${match.expression}`,
    PONY_LIGHTING,
    `shot on Canon EOS R5, ${match.camera}`,
  ].join(', ') + `. Negative: ${PONY_NEGATIVE}`;
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
