/**
 * Nanobanana2（Google Gemini 3.1 Flash Image）画像生成
 * nanobananaapi.ai 経由
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

/**
 * テキストプロンプトから画像を生成し、画像URLを返す
 */
export async function generateImage(prompt: string): Promise<string> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('NANOBANANA_API_KEY が設定されていません');

  const res = await fetch(`${NANOBANANA_API_BASE}/generate`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt,
      numImages: 1,
      type: 'TEXTTOIAMGE',
      image_size: '9:16',
      callBackUrl: CALLBACK_URL,
    }),
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

/**
 * ツイート内容と商品情報からNanobanana2用の画像プロンプトを生成する
 */
export function buildImagePrompt(tweetText: string, productTitle?: string): string {
  const faceBase = 'cute japanese idol girl, baby face, round chubby cheeks, small cute button nose, large round sparkling eyes with aegyo sal, soft rounded facial features, gentle smile, mouth corners slightly upturned, see-through bangs, dark brown hair, warm youthful glow, subtle glossy lips, light blush';

  const base = productTitle
    ? `${faceBase}, cinematic portrait, soft studio lighting, delicate collarbone highlight, inspired by: "${productTitle.slice(0, 60)}"`
    : `${faceBase}, cinematic portrait, soft studio lighting, delicate collarbone highlight`;

  return `${base}. High quality, 8K, photorealistic, tasteful and artistic. No explicit content, no anime, no cartoon.`;
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
