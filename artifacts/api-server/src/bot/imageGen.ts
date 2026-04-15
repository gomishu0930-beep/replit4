/**
 * 画像生成モジュール
 * - fal.ai Realistic Vision (プライマリ): NSFW対応・フォトリアル特化
 * - Nanobanana2 (セカンダリ): 参照画像対応
 * - DALL-E 3 (最終フォールバック): 安全重視
 *
 * 優先順位: fal.ai → Nanobanana2 → DALL-E 3
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
  if (isFalEnabled()) active = 'fal.ai Realistic Vision';
  else if (isNanobananaEnabled() && !nanoDisabled) active = 'Nanobanana2';
  else if (isDalleEnabled()) active = 'DALL-E 3';

  return {
    primary: isFalEnabled() ? 'fal.ai (有効)' : 'fal.ai (キー未設定)',
    secondary: isNanobananaEnabled() ? (nanoDisabled ? 'Nanobanana2 (クレジット不足)' : 'Nanobanana2 (有効)') : 'Nanobanana2 (キー未設定)',
    fallback: isDalleEnabled() ? 'DALL-E 3 (有効)' : 'DALL-E 3 (キー未設定)',
    nanobananaDisabled: nanoDisabled,
    activeEngine: active,
  };
}

export interface GenerateImageOptions {
  referenceImageUrls?: string[];
  safetyTolerance?: number;
  engine?: ImageEngine;
}

export async function generateImage(prompt: string, options?: GenerateImageOptions): Promise<string> {
  const engine = options?.engine ?? 'auto';
  const hasRefs = (options?.referenceImageUrls?.filter(u => u?.startsWith('http'))?.length ?? 0) > 0;

  if (engine === 'fal') return await generateWithFal(prompt);
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
      return await generateWithFal(prompt);
    } catch (e: any) {
      console.warn(`  ⚠ [fal.ai] 生成失敗: ${e.message} → 次のエンジンへ`);
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

// ─── fal.ai Realistic Vision（同期API） ──────────────────────────────────────

async function generateWithFal(prompt: string): Promise<string> {
  const apiKey = getFalKey();
  if (!apiKey) throw new Error('FAL_KEY が設定されていません');

  console.log(`  🎯 [fal.ai] Realistic Vision 画像生成開始（同期モード）...`);

  const negativeStart = prompt.indexOf('Negative:');
  let mainPrompt = prompt;
  let negativePrompt = '(worst quality:1.4), (low quality:1.4), plastic skin, airbrushed skin, overly smooth skin, wax figure, mannequin, CGI, digital art, illustration, painting, 3d render, deformed iris, deformed pupils, semi-realistic, overexposed, underexposed, watermark, text, logo, cropped';
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
    throw new Error(`fal.ai 生成失敗: ${json?.detail ?? json?.message ?? res.status}`);
  }

  const imageUrl = json?.images?.[0]?.url;
  if (!imageUrl) throw new Error('fal.ai: 画像URLが取得できませんでした');

  const inferenceTime = json?.timings?.inference ? `${json.timings.inference.toFixed(1)}s` : '?';
  console.log(`  🎯 [fal.ai] 生成完了！ 推論${inferenceTime} / 合計${elapsed}s / ${imageUrl.slice(0, 80)}...`);
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

// ─── プロンプトビルダー（テンプレート版 — Claude生成失敗時のフォールバック） ──

const QUALITY_PREFIX = '(photorealistic:1.3), (masterpiece:1.2), (best quality:1.2), RAW photo';

const FACE_YOUNG = 'cute japanese idol girl, baby face, round chubby cheeks, small cute button nose, large round sparkling eyes with aegyo sal, soft rounded facial features, gentle smile, mouth corners slightly upturned, see-through bangs, straight medium-length dark brown hair, warm youthful glow, subtle glossy lips, light blush, natural skin texture with visible pores, fine peach fuzz on cheeks, subsurface scattering on ear tips, tiny beauty mark near jawline, natural stray hair wisps';
const FACE_MATURE = 'beautiful japanese woman, soft feminine features, gentle rounded cheeks, almond-shaped sophisticated eyes with natural catchlight, elegant smile, side-swept bangs, layered medium-length dark brown hair, warm natural glow, glossy lips, natural skin texture with visible pores, delicate collarbone, refined jawline';
const FACE_OLDER = 'elegant mature japanese beauty, refined features, high cheekbones, defined jawline, deep expressive eyes with wisdom, sophisticated smile, layered medium-length hair, luminous skin, subtle makeup, natural skin texture, graceful neck and collarbone';

const SFW_TAGS = 'covered chest, modest neckline, appropriate clothing';
const LIGHTING = 'soft diffused golden-hour sunlight, creamy cinematic bokeh, film grain, volumetric haze';
const NEGATIVE = '(worst quality:1.4), (low quality:1.4), plastic skin, airbrushed skin, overly smooth skin, wax figure, mannequin, CGI, digital art, illustration, painting, 3d render, deformed iris, deformed pupils, semi-realistic, overexposed, underexposed, watermark, text, logo, cropped';

export function buildImagePrompt(tweetText: string, productTitle?: string): string {
  const src = productTitle || tweetText;

  const sceneMap: [RegExp, string[], string, string][] = [
    [/温泉|風呂|入浴/, ['wearing yukata loosely draped', 'traditional japanese hot spring inn, steamy wooden bath', 'relaxed expression, wet hair'], 'young', '50mm f/2.0'],
    [/OL|オフィス|上司|部下|会社/, ['wearing fitted business blouse and pencil skirt', 'modern office with glass windows, city view', 'confident pose, adjusting glasses'], 'mature', '50mm f/2.0'],
    [/教師|先生|授業/, ['wearing teacher outfit, white blouse, tight skirt, glasses', 'empty classroom after hours, blackboard, sunset light', 'flustered expression, holding textbook'], 'mature', '50mm f/2.0'],
    [/ナース|看護|病院/, ['wearing nurse uniform, stethoscope around neck', 'hospital room at night, dim fluorescent lighting', 'leaning forward, caring expression'], 'young', '50mm f/2.0'],
    [/メイド|喫茶/, ['wearing classic maid outfit with headband and apron', 'cozy vintage cafe interior, warm lighting', 'cheerful smile, serving pose'], 'young', '50mm f/2.0'],
    [/制服|JK|女子校/, ['wearing school sailor uniform, plaid skirt at knee', 'school hallway with lockers, afternoon sunlight', 'shy expression, looking away'], 'young', '35mm f/1.8'],
    [/水着|プール|海|ビーチ/, ['wearing modest one-piece swimsuit', 'tropical beach, crystal clear water, golden hour', 'playful smile, sunlit skin'], 'young', '85mm f/1.4'],
    [/人妻|奥さん|妻/, ['wearing casual apron over home clothes, wedding ring visible', 'modern kitchen, warm domestic lighting', 'gentle smile with hint of loneliness'], 'mature', '50mm f/2.0'],
    [/電車|痴漢|通勤/, ['wearing office attire, blouse', 'inside crowded train, handrail, motion blur', 'nervous expression'], 'mature', '35mm f/1.8'],
    [/マッサージ|エステ/, ['wrapped in white towel', 'luxury spa room, candles, oil bottles', 'eyes closed, relaxed expression'], 'young', '50mm f/2.0'],
    [/コスプレ/, ['wearing elaborate cosplay outfit', 'convention booth, colorful backdrop', 'energetic pose, peace sign'], 'young', '85mm f/1.4'],
    [/不倫|浮気|密会/, ['wearing elegant cocktail dress', 'dimly lit hotel room, city night view from window', 'guilty yet seductive expression, sitting on bed edge'], 'mature', '50mm f/2.0'],
    [/巨乳|爆乳/, ['wearing tight fitted top', 'casual bedroom setting, soft window light', 'looking at camera, hair over shoulder'], 'young', '85mm f/1.4'],
    [/素人|個人撮影/, ['wearing casual everyday clothes', 'apartment room, natural daylight', 'candid expression, selfie angle'], 'young', '35mm f/1.8'],
    [/熟女/, ['wearing sophisticated dress', 'upscale bar or restaurant, warm amber lighting', 'knowing smile, wine glass in hand'], 'older', '85mm f/1.4'],
  ];

  let outfit = 'wearing casual clothes';
  let scene = 'softly lit indoor setting';
  let expression = 'natural expression';
  let ageType = 'young';
  let camera = '50mm f/2.0';

  for (const [re, parts, age, cam] of sceneMap) {
    if (re.test(src)) {
      [outfit, scene, expression] = parts;
      ageType = age;
      camera = cam;
      break;
    }
  }

  const faceBase = ageType === 'older' ? FACE_OLDER : ageType === 'mature' ? FACE_MATURE : FACE_YOUNG;

  return `${QUALITY_PREFIX}, ${faceBase}, ${SFW_TAGS}, ${outfit}, in a ${scene}, with ${expression}, ${LIGHTING}, shot on Sony A7IV ${camera}. Negative: ${NEGATIVE}`;
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
