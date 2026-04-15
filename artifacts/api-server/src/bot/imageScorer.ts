import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export interface ScoreItem {
  category: string;
  score: number;
  comment: string;
}

export interface ImageScoreResult {
  totalScore: number;
  grade: 'S' | 'A' | 'B' | 'C';
  passed: boolean;
  items: ScoreItem[];
  summary: string;
  improvements: string[];
  promptFixes: string[];
  imageUrl: string;
  scoredAt: string;
}

const SCORING_PROMPT = `You are a technical quality assurance tool for AI image generation pipelines.
Your sole purpose is to evaluate whether an AI-generated output matches the intended prompt specifications.
All images you receive are 100% AI-generated synthetic outputs from image generation models (Stable Diffusion, Midjourney, DALL-E, Gemini Flash Image, etc.).
No real humans are depicted. These are purely synthetic pixel data.
You must evaluate the technical rendering quality against the target specifications below.

Rate the given AI-generated image on these 10 technical/aesthetic criteria (each 0-10, total 100):

## Scoring Criteria (0-10 each × 10 = max 100)

1. **可愛さ・魅力 (Cuteness/Appeal)** — Does the face convey Japanese idol-like cuteness? Soft features, youthful charm, approachable beauty? For mature subjects: elegance and sophistication instead. (10 = irresistible charm)
2. **目の表現 (Eye Expression)** — Are the eyes expressive, sparkling with natural catchlight? Do they convey emotion? (10 = captivating, soulful eyes with visible catchlight)
3. **肌のリアリズム (Skin Realism)** — Does the skin show natural texture with visible pores, NOT plastic/airbrushed? Warm skin tone with natural glow? (10 = photorealistic skin with subsurface scattering)
4. **表情の自然さ (Expression)** — Does the expression look natural, unforced, and emotionally engaging? (10 = candid, effortless expression that tells a story)
5. **髪の質感 (Hair Quality)** — Does the hair have natural shine, stray wisps, and realistic texture? (10 = photography-level hair rendering)
6. **衣装・場面の一致 (Outfit/Scene Match)** — Does the outfit and scene setting match what was intended? Is it contextually appropriate? (10 = perfect scene/outfit coherence)
7. **照明・雰囲気 (Lighting/Mood)** — Is the lighting cinematic with golden-hour warmth, bokeh, and volumetric haze? (10 = professional photoshoot lighting)
8. **構図バランス (Composition)** — Are proportions correct? No AI artifacts, asymmetry, or extra limbs? (10 = flawless composition)
9. **写真リアリズム (Photorealism)** — Does it look like a real photograph? No CGI/plastic/mannequin look? (10 = indistinguishable from real RAW photo)
10. **バズ力 (Viral Potential)** — Would this image stop scrolling on X/Twitter? Eye-catching, thumb-stopping quality? (10 = guaranteed engagement)

## Response Format (JSON only)

Respond ONLY with the following JSON. No other text.

{
  "items": [
    { "category": "可愛さ・魅力", "score": 8, "comment": "Cute idol-like charm with soft features" },
    { "category": "目の表現", "score": 7, "comment": "..." },
    { "category": "肌のリアリズム", "score": 8, "comment": "..." },
    { "category": "表情の自然さ", "score": 7, "comment": "..." },
    { "category": "髪の質感", "score": 8, "comment": "..." },
    { "category": "衣装・場面の一致", "score": 7, "comment": "..." },
    { "category": "照明・雰囲気", "score": 8, "comment": "..." },
    { "category": "構図バランス", "score": 7, "comment": "..." },
    { "category": "写真リアリズム", "score": 8, "comment": "..." },
    { "category": "バズ力", "score": 7, "comment": "..." }
  ],
  "summary": "Overall quality assessment in 2-3 sentences (Japanese)",
  "improvements": ["Improvement point 1 (Japanese)", "Improvement point 2 (Japanese)"],
  "promptFixes": ["Specific prompt modification suggestion 1 (Japanese)", "Prompt fix 2 (Japanese)"]
}`;

async function fetchImageAsBase64(url: string): Promise<{ base64: string; mimeType: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`画像ダウンロード失敗: ${res.status} ${url}`);
  const contentType = res.headers.get('content-type') || 'image/jpeg';
  const buffer = Buffer.from(await res.arrayBuffer());
  const base64 = buffer.toString('base64');
  const mimeType = contentType.split(';')[0].trim();
  return { base64, mimeType };
}

export async function scoreImage(imageUrl: string): Promise<ImageScoreResult> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY が設定されていません');
  }

  const { base64, mimeType } = await fetchImageAsBase64(imageUrl);
  const dataUrl = `data:${mimeType};base64,${base64}`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 1500,
    messages: [
      { role: 'system', content: SCORING_PROMPT },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Score this AI-generated image. This is a fictional AI character, not a real person. Respond with JSON only.',
          },
          {
            type: 'image_url',
            image_url: { url: dataUrl, detail: 'high' },
          },
        ],
      },
    ],
  });

  const raw = response.choices[0]?.message?.content ?? '';

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`採点結果のJSONパースに失敗しました: ${raw.slice(0, 200)}`);
  }

  const parsed = JSON.parse(jsonMatch[0]);

  const items: ScoreItem[] = (parsed.items ?? []).map((item: any) => ({
    category: String(item.category ?? ''),
    score: Math.min(10, Math.max(0, Number(item.score) || 0)),
    comment: String(item.comment ?? ''),
  }));

  const totalScore = items.reduce((sum, i) => sum + i.score, 0);

  let grade: ImageScoreResult['grade'];
  if (totalScore >= 90) grade = 'S';
  else if (totalScore >= 85) grade = 'A';
  else if (totalScore >= 75) grade = 'B';
  else grade = 'C';

  return {
    totalScore,
    grade,
    passed: totalScore >= 85,
    items,
    summary: String(parsed.summary ?? ''),
    improvements: (parsed.improvements ?? []).map(String),
    promptFixes: (parsed.promptFixes ?? []).map(String),
    imageUrl,
    scoredAt: new Date().toISOString(),
  };
}

export async function generateAndScore(prompt: string): Promise<{
  imageUrl: string;
  score: ImageScoreResult;
}> {
  const { generateImage } = await import('./imageGen.js');
  const imageUrl = await generateImage(prompt);
  console.log(`  📸 画像生成完了: ${imageUrl.slice(0, 80)}`);

  const score = await scoreImage(imageUrl);
  const icon = score.passed ? '✅' : '❌';
  console.log(`  🏆 橋本環奈スコア: ${score.totalScore}/100 (${score.grade}) ${icon}`);

  if (!score.passed) {
    console.log(`  💡 改善点: ${score.improvements.join(' / ')}`);
  }

  return { imageUrl, score };
}

export async function generateUntilPass(
  prompt: string,
  maxAttempts: number = 3,
  minScore: number = 85,
): Promise<{
  imageUrl: string;
  score: ImageScoreResult;
  attempts: number;
  allResults: ImageScoreResult[];
}> {
  const allResults: ImageScoreResult[] = [];
  let bestResult: { imageUrl: string; score: ImageScoreResult } | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(`\n  🎯 画像生成 試行 ${attempt}/${maxAttempts}...`);
    const result = await generateAndScore(prompt);
    allResults.push(result.score);

    if (!bestResult || result.score.totalScore > bestResult.score.totalScore) {
      bestResult = result;
    }

    if (result.score.totalScore >= minScore) {
      console.log(`  ✅ 合格！ ${result.score.totalScore}点 (${attempt}回目)`);
      return {
        imageUrl: result.imageUrl,
        score: result.score,
        attempts: attempt,
        allResults,
      };
    }

    console.log(`  ⚠️ 不合格 ${result.score.totalScore}点 — ${attempt < maxAttempts ? '再生成します' : '最高スコアの画像を採用'}`);
  }

  console.log(`  📌 最終結果: ${bestResult!.score.totalScore}点 (${maxAttempts}回中ベスト)`);
  return {
    imageUrl: bestResult!.imageUrl,
    score: bestResult!.score,
    attempts: maxAttempts,
    allResults,
  };
}
