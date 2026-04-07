/**
 * algo.ts — X (Twitter) アルゴリズム自動解析モジュール
 *
 * 方針:
 *  - ハルシネーション防止: 分析は100%自アカウント実投稿データのみ
 *  - 統計的根拠: 平均・相関・サンプルサイズを明示
 *  - AI議論: Claude(分析/仮説) → o3(懐疑/反論) → Claude(統合)
 *  - 週次自動実行 + ダッシュボード表示
 */

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { getAllPosts, saveAlgoInsight, AlgoInsight } from './storage.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function getAnthropicClient() {
  const baseUrl = process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL;
  const apiKey  = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;
  if (!baseUrl || !apiKey) throw new Error('Anthropic env vars not set (AI_INTEGRATIONS_ANTHROPIC_*)');
  return new Anthropic({ baseURL: baseUrl, apiKey });
}

// ─── 特徴量抽出 ────────────────────────────────────────────────────────────────

interface PostFeatures {
  tweetId: string;
  postedAt: string;
  hourJST: number;
  dayOfWeek: number;          // 0=日, 1=月 ... 6=土
  type: string;
  textLength: number;
  emojiCount: number;
  lineCount: number;
  hasQuestion: boolean;
  hasExclamation: boolean;
  hasNumber: boolean;
  impressions: number;
  likeCount: number;
  replyCount: number;
  retweetCount: number;
  bookmarkCount: number;
  engagementRate: number;     // (likes+RT+replies+bookmarks) / impressions
  engagementScore: number;    // likes*3 + RT*5 + replies*2 + bookmarks*2
}

function extractFeatures(post: any): PostFeatures | null {
  const m = post.metrics;
  if (!m || m.impression_count == null) return null;

  const postedAt = new Date(post.postedAt);
  const jstOffset = 9 * 60 * 60 * 1000;
  const jst = new Date(postedAt.getTime() + jstOffset);
  const hourJST = jst.getUTCHours();
  const dayOfWeek = jst.getUTCDay();

  const text = post.text ?? '';
  const emojiCount = [...text].filter(ch => {
    const code = ch.codePointAt(0) ?? 0;
    return code > 0x1F000;
  }).length;

  const imp = m.impression_count ?? 0;
  const likes = m.like_count ?? 0;
  const rt    = m.retweet_count ?? 0;
  const rep   = m.reply_count ?? 0;
  const bm    = m.bookmark_count ?? 0;
  const engScore = likes * 3 + rt * 5 + rep * 2 + bm * 2;
  const engRate  = imp > 0 ? (likes + rt + rep + bm) / imp : 0;

  return {
    tweetId: post.tweetId,
    postedAt: post.postedAt,
    hourJST,
    dayOfWeek,
    type: post.type ?? 'unknown',
    textLength: text.length,
    emojiCount,
    lineCount: text.split('\n').length,
    hasQuestion: text.includes('？') || text.includes('?'),
    hasExclamation: text.includes('！') || text.includes('!'),
    hasNumber: /[0-9０-９]/.test(text),
    impressions: imp,
    likeCount: likes,
    replyCount: rep,
    retweetCount: rt,
    bookmarkCount: bm,
    engagementRate: engRate,
    engagementScore: engScore,
  };
}

// ─── 統計分析 ──────────────────────────────────────────────────────────────────

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((s, x) => s + x, 0) / arr.length;
}

function pearsonCorr(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 3) return NaN;
  const mx = mean(xs), my = mean(ys);
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    num += dx * dy; dx2 += dx * dx; dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  return denom === 0 ? 0 : num / denom;
}

function groupBy<T>(arr: T[], key: (x: T) => string): Record<string, T[]> {
  return arr.reduce((acc, x) => {
    const k = key(x);
    (acc[k] ??= []).push(x);
    return acc;
  }, {} as Record<string, T[]>);
}

export interface AlgoStats {
  sampleSize: number;
  generatedAt: string;

  // 投稿タイプ別 平均インプ
  byType: Array<{ type: string; avgImp: number; avgEng: number; count: number }>;

  // 時間帯別 平均インプ (有効データのみ)
  byHour: Array<{ hour: number; avgImp: number; count: number }>;

  // 曜日別
  byDayOfWeek: Array<{ day: number; label: string; avgImp: number; count: number }>;

  // 相関係数 (vs impressions)
  correlations: {
    textLength:   number;
    emojiCount:   number;
    lineCount:    number;
    hasQuestion:  number;
    hasNumber:    number;
  };

  // 上位・下位 投稿
  topPosts: Array<{ tweetId: string; postedAt: string; type: string; impressions: number; engScore: number }>;
  bottomPosts: Array<{ tweetId: string; postedAt: string; type: string; impressions: number; engScore: number }>;

  // raw features (AIに渡す用)
  features: PostFeatures[];
}

export function computeAlgoStats(): AlgoStats {
  const posts = getAllPosts();
  const features = posts.map(extractFeatures).filter((f): f is PostFeatures => f !== null);
  const n = features.length;

  const imps = features.map(f => f.impressions);

  // タイプ別
  const byTypeMap = groupBy(features, f => f.type);
  const byType = Object.entries(byTypeMap).map(([type, fs]) => ({
    type,
    avgImp: Math.round(mean(fs.map(f => f.impressions))),
    avgEng: parseFloat(mean(fs.map(f => f.engagementScore)).toFixed(2)),
    count: fs.length,
  })).sort((a, b) => b.avgImp - a.avgImp);

  // 時間帯別
  const byHourMap = groupBy(features, f => String(f.hourJST));
  const byHour = Object.entries(byHourMap).map(([h, fs]) => ({
    hour: Number(h),
    avgImp: Math.round(mean(fs.map(f => f.impressions))),
    count: fs.length,
  })).sort((a, b) => a.hour - b.hour);

  // 曜日別
  const DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];
  const byDowMap = groupBy(features, f => String(f.dayOfWeek));
  const byDayOfWeek = Object.entries(byDowMap).map(([d, fs]) => ({
    day: Number(d),
    label: DAY_LABELS[Number(d)],
    avgImp: Math.round(mean(fs.map(f => f.impressions))),
    count: fs.length,
  })).sort((a, b) => a.day - b.day);

  // 相関
  const correlations = {
    textLength:  parseFloat(pearsonCorr(features.map(f => f.textLength),  imps).toFixed(3)),
    emojiCount:  parseFloat(pearsonCorr(features.map(f => f.emojiCount),  imps).toFixed(3)),
    lineCount:   parseFloat(pearsonCorr(features.map(f => f.lineCount),   imps).toFixed(3)),
    hasQuestion: parseFloat(pearsonCorr(features.map(f => f.hasQuestion ? 1 : 0), imps).toFixed(3)),
    hasNumber:   parseFloat(pearsonCorr(features.map(f => f.hasNumber ? 1 : 0),   imps).toFixed(3)),
  };

  const sorted = [...features].sort((a, b) => b.impressions - a.impressions);
  const toSummary = (f: PostFeatures) => ({
    tweetId: f.tweetId, postedAt: f.postedAt, type: f.type,
    impressions: f.impressions, engScore: f.engagementScore,
  });
  const topPosts    = sorted.slice(0, 5).map(toSummary);
  const bottomPosts = sorted.slice(-3).map(toSummary);

  return { sampleSize: n, generatedAt: new Date().toISOString(), byType, byHour, byDayOfWeek, correlations, topPosts, bottomPosts, features };
}

// ─── AI 議論 ───────────────────────────────────────────────────────────────────

function statsToText(s: AlgoStats): string {
  const corrText = Object.entries(s.correlations)
    .map(([k, v]) => `  ${k}: r=${isNaN(v) ? 'N/A' : v}`)
    .join('\n');

  const typeText = s.byType.map(t =>
    `  ${t.type}: 平均${t.avgImp}imp / エンゲ${t.avgEng} (n=${t.count})`
  ).join('\n');

  const hourText = s.byHour.map(h =>
    `  ${String(h.hour).padStart(2,'0')}時: 平均${h.avgImp}imp (n=${h.count})`
  ).join('\n');

  return `【Xアルゴリズム解析データ（実データ・サンプル数: ${s.sampleSize}件）】

⚠️ サンプルサイズが小さいため統計的信頼性は低い。仮説として扱うこと。

■ 投稿タイプ別 平均インプレッション:
${typeText}

■ 時間帯別 平均インプレッション:
${hourText}

■ インプレッション数との相関係数:
${corrText}
  (相関係数解釈: |r|<0.2=無相関, 0.2-0.4=弱, 0.4-0.6=中, >0.6=強)

■ 高パフォーマンス投稿 TOP3:
${s.topPosts.slice(0,3).map(p => `  [${p.type}] ${p.impressions}imp / エンゲ${p.engScore} (${new Date(p.postedAt).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})})`).join('\n')}`;
}

async function claudeAnalyze(statsText: string): Promise<string> {
  const client = getAnthropicClient();
  const res = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 1500,
    system: `あなたはXアルゴリズムの実証分析専門家です。
提供されたデータのみを根拠に分析し、データにない事柄は「データ不足」と明記してください。
ハルシネーション厳禁。仮説には必ず根拠数値を引用してください。`,
    messages: [{
      role: 'user',
      content: `以下の実データからXアルゴリズムに関する仮説を3つ提示してください。
各仮説は: ①データ根拠 ②実務的含意 ③信頼性（サンプル数を考慮）を明記。

${statsText}`,
    }],
  });
  return res.content[0].type === 'text' ? res.content[0].text : '';
}

async function o3Challenge(statsText: string, claudeHypothesis: string): Promise<string> {
  const res = await openai.chat.completions.create({
    model: 'o3',
    max_completion_tokens: 1500,
    messages: [
      {
        role: 'system',
        content: `あなたは統計的批判思考の専門家です。Claudeが提示した仮説を批判的に検証してください。
データの限界（サンプルサイズ・シャドウバンの影響・交絡因子）を指摘し、代替仮説も提示してください。
批判は建設的に行い、反証可能な形で。`,
      },
      {
        role: 'user',
        content: `【実データ】\n${statsText}\n\n【Claudeの仮説】\n${claudeHypothesis}\n\n上記仮説の問題点・代替説明・見落としを指摘してください。`,
      },
    ],
  });
  return res.choices[0].message.content ?? '';
}

async function claudeSynthesize(
  statsText: string,
  claudeHypothesis: string,
  o3Challenge: string,
): Promise<string> {
  const client = getAnthropicClient();
  const res = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 1200,
    system: `あなたはXアルゴリズムの実証分析専門家です。o3の批判を受けて仮説を更新してください。
認めるべき点は認め、主張すべき点は根拠を強化して維持してください。
最終的に「今週実行すべきアクション」を3つ以内で具体的に提示してください。`,
    messages: [{
      role: 'user',
      content: `【データ】\n${statsText}\n\n【当初仮説】\n${claudeHypothesis}\n\n【o3の批判】\n${o3Challenge}\n\no3の指摘を踏まえた改訂版分析と、今週のアクションプランを出してください。`,
    }],
  });
  return res.content[0].type === 'text' ? res.content[0].text : '';
}

async function buildBriefing(synthesis: string, stats: AlgoStats): Promise<string> {
  const client = getAnthropicClient();
  const res = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 400,
    system: 'アカウント運営者向けの週次アルゴリズム解析サマリーを日本語で作成してください。5行以内・箇条書き・具体的数値を含める。',
    messages: [{
      role: 'user',
      content: `以下の議論から、運営者に伝えるべき要点を5行以内でまとめてください:\n\n${synthesis}\n\nサンプル数: ${stats.sampleSize}件`,
    }],
  });
  return res.content[0].type === 'text' ? res.content[0].text : '';
}

// ─── メインエントリ ────────────────────────────────────────────────────────────

export async function runAlgoAnalysis(): Promise<AlgoInsight> {
  console.log('\n  🔬 [アルゴ解析] 開始...');
  const stats = computeAlgoStats();

  if (stats.sampleSize < 5) {
    throw new Error(`サンプル不足 (${stats.sampleSize}件 / 最低5件必要)`);
  }

  const statsText = statsToText(stats);
  console.log('  🧠 [Claude] 仮説生成中...');
  const hypothesis = await claudeAnalyze(statsText);

  console.log('  🤖 [o3] 批判的検証中...');
  const challenge = await o3Challenge(statsText, hypothesis);

  console.log('  🧠 [Claude] 統合・アクションプラン生成中...');
  const synthesis = await claudeSynthesize(statsText, hypothesis, challenge);

  console.log('  📋 ブリーフィング生成中...');
  const briefing = await buildBriefing(synthesis, stats);

  const insight: AlgoInsight = {
    generatedAt: new Date().toISOString(),
    sampleSize: stats.sampleSize,
    stats: {
      byType: stats.byType,
      byHour: stats.byHour,
      byDayOfWeek: stats.byDayOfWeek,
      correlations: stats.correlations,
      topPosts: stats.topPosts,
      bottomPosts: stats.bottomPosts,
    },
    discussion: {
      claudeHypothesis: hypothesis,
      o3Challenge: challenge,
      claudeSynthesis: synthesis,
    },
    briefing,
  };

  saveAlgoInsight(insight);
  console.log('  ✅ [アルゴ解析] 完了');
  return insight;
}
