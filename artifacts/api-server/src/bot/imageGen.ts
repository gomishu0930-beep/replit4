/**
 * Nanobanana2（Google Gemini 3.1 Flash Image）画像生成
 * nanobananaapi.ai 経由
 * - テキストのみ生成（text-to-image）
 * - サンプル画像参照生成（image-to-image）対応
 */

const NANOBANANA_API_BASE = 'https://api.nanobananaapi.ai/api/v1/nanobanana';
const CALLBACK_URL = 'https://asset-manager-3-gomishu0930.replit.app/api/nanobanana/callback';
const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 120000;

function getApiKey(): string {
  return process.env.NANOBANANA_API_KEY ?? '';
}

export function isNanobananaEnabled(): boolean {
  return !!getApiKey();
}

export interface GenerateImageOptions {
  referenceImageUrls?: string[];
  safetyTolerance?: number;
}

export async function generateImage(prompt: string, options?: GenerateImageOptions): Promise<string> {
  const apiKey = getApiKey();
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

  if (refs.length > 0) {
    body.referenceImageUrls = refs.slice(0, 4);
    console.log(`  🍌 [Nanobanana2] 参照画像 ${refs.length}枚 → image-to-image モード`);
  } else {
    body.type = 'TEXTTOIAMGE';
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
  return await pollTask(taskId, apiKey);
}

async function pollTask(taskId: string, apiKey: string): Promise<string> {
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

export function buildImagePrompt(tweetText: string, productTitle?: string): string {
  const faceBase = 'RAW photo, cute japanese idol girl, baby face, round chubby cheeks, small cute button nose, large round sparkling eyes with aegyo sal, soft rounded facial features, gentle smile, mouth corners slightly upturned, see-through bangs, dark brown hair, warm youthful glow, subtle glossy lips, light blush, natural skin texture with visible pores, fine peach fuzz on cheeks, subsurface scattering on ear tips, tiny beauty mark near jawline, natural stray hair wisps';

  const sceneMap: [RegExp, string][] = [
    [/温泉|風呂|入浴/, 'wearing yukata, hot spring inn, steamy atmosphere'],
    [/OL|オフィス|上司|部下|会社/, 'wearing office blouse and pencil skirt, modern office background'],
    [/教師|先生|学校|授業/, 'wearing teacher outfit with glasses, classroom background'],
    [/ナース|看護|病院/, 'wearing nurse uniform, hospital corridor background'],
    [/メイド|喫茶/, 'wearing maid outfit with headband, cozy cafe interior'],
    [/制服|JK|女子校/, 'wearing school uniform sailor outfit, school hallway'],
    [/水着|プール|海|ビーチ/, 'wearing one-piece swimsuit, poolside, summer sunlight'],
    [/人妻|奥さん|妻/, 'elegant mature woman, wearing casual home outfit, kitchen background'],
    [/電車|痴漢|通勤/, 'standing in crowded train, nervous expression, wearing office attire'],
    [/マッサージ|エステ/, 'lying on massage table, spa room, wearing towel wrap'],
    [/コスプレ/, 'wearing cosplay outfit, colorful background'],
    [/不倫|浮気|密会/, 'hotel room, dim warm lighting, wearing elegant dress, guilty expression'],
  ];

  let sceneHint = 'cinematic portrait, delicate collarbone highlight';
  const src = productTitle || tweetText;
  for (const [re, desc] of sceneMap) {
    if (re.test(src)) { sceneHint = desc; break; }
  }

  const base = `${faceBase}, ${sceneHint}, shot on Sony A7IV 85mm f/1.4, volumetric haze, film grain, 8K, photorealistic, shallow depth of field`;

  return `${base}. Negative: nude, naked, explicit, NSFW, nipple, underwear, lingerie, cartoon, anime, CGI, plastic skin, airbrushed skin.`;
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
