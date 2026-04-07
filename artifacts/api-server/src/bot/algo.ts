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

// ─── Xアルゴリズム知識ベース（ハルシネーション防止: 出典明記済みのみ）────────────

/**
 * 出典:
 *  A) Twitter/X公式オープンソース (github.com/twitter/the-algorithm, 2023/04公開)
 *  B) Elon Musk / X公式アカウントの公式発言
 *  C) X公式ドキュメント (developer.twitter.com)
 *  D) サードパーティ実験で繰り返し再現された事実 (複数独立確認)
 */
export const X_ALGO_KB = {
  version: '2025-Q1',
  sources: [
    'A: github.com/twitter/the-algorithm (公開2023/04)',
    'B: X/Elon公式発言',
    'C: X Developer Docs',
    'D: 複数独立実験で再現確認済み',
  ],

  // ─── スコアリング（A: Heavy Ranker から）─────────────────────────────────────
  scoring: [
    {
      rule: 'リプライ > いいね の重み付け',
      detail: 'Heavy Rankerでリプライスコア(ReplyScore)はいいねより高いウェイト。「返信したくなる」ツイートがアルゴ優遇される。',
      source: 'A',
      implication: 'エンゲージメント誘導文・質問型ツイートは特に有効',
    },
    {
      rule: 'ブックマークは強いポジティブシグナル',
      detail: 'UserBookmarkCountがHeavy Rankerの特徴量に含まれる。ブックマークはスパムになりにくいため信頼性が高いシグナルとして扱われる。',
      source: 'A',
      implication: '「保存したくなる」情報価値の高いコンテンツが有利',
    },
    {
      rule: '時間減衰: 投稿後の最初の30分が最重要',
      detail: 'TweetAgeSecondsが減衰関数として機能。初期エンゲージメントが高いほど広範なOutOfNetworkに配信される閾値を超えやすい。',
      source: 'A+D',
      implication: 'フォロワーが最もアクティブな時間帯に投稿することが最重要',
    },
    {
      rule: '外部リンクはリーチを削減する',
      detail: 'Elonが明言。XはユーザーをX内に留めることを優先するため、外部URLを含むツイートは配信スコアが低下する。',
      source: 'B',
      implication: 'リプライ欄にURLを分離する戦略（本ボットの設計）は正しい',
    },
    {
      rule: 'センシティブコンテンツフラグは配信を大幅削減',
      detail: 'ContentTypeシグナルがアダルト/センシティブ判定されるとOutOfNetwork配信が著しく制限される。シャドウバンの主因。',
      source: 'A+C',
      implication: 'シャドウバン中アカウントへの影響は複合的。回復には非センシティブ投稿との混在が有効とされる。',
    },
    {
      rule: 'フォロワー数/エンゲージメント比がスパム判定に影響',
      detail: '大量フォロワーに対してエンゲージメントが極端に低い場合、スパムアカウントとして配信が絞られる。',
      source: 'A+D',
      implication: '341フォロワー帯では各投稿で最低1リプライを確保することが重要',
    },
  ],

  // ─── 配信パイプライン ─────────────────────────────────────────────────────────
  pipeline: [
    {
      rule: 'InNetwork (フォロワー) vs OutOfNetwork (フォロワー外) の2段階配信',
      detail: 'まずフォロワーに配信し、そのエンゲージメント率が閾値を超えるとOutOfNetworkに拡張。小アカウントの拡散はこの仕組み次第。',
      source: 'A',
      implication: 'フォロワー341人のうち何人がエンゲージするかが拡散の起点',
    },
    {
      rule: 'Blue認証アカウントは配信ブースト',
      detail: 'AuthorIsBlueVerifiedがHeavy Rankerの正のシグナル。',
      source: 'A',
      implication: 'Blue加入で配信有利になる可能性あり（費用対効果は別途検討）',
    },
    {
      rule: 'スレッド（リプライチェーン）は親ツイートのスコアに加算',
      detail: 'スレッド内のエンゲージメントは親ツイートの評価に集約される仕組みがある。',
      source: 'D',
      implication: '本ボットの3連投稿（本文→リンクリプライ→エンゲージメント誘導）戦略と整合',
    },
  ],

  // ─── センシティブコンテンツ特有のルール ─────────────────────────────────────
  nsfw: [
    {
      rule: 'NSFWコンテンツはデフォルトでOutOfNetwork配信が無効',
      detail: 'センシティブフラグが立ったアカウント/ツイートは、フォロワー以外への配信が大幅に制限される。',
      source: 'C',
      implication: 'シャドウバン回復前はフォロワー341人の質的関係が全て',
    },
    {
      rule: '非センシティブツイートとの混在が回復を促進する可能性',
      detail: '複数の実験で、定期的に非アダルトコンテンツを混ぜるとシャドウバン回復が早まる事例が報告されている。',
      source: 'D (独立確認多数だが公式未確認)',
      implication: '手動投稿の芸能人・時事ネタツイートはアルゴリズム的にも意義がある',
    },
  ],

  // ─── 未確認・議論中のルール ─────────────────────────────────────────────────
  uncertain: [
    {
      rule: 'ハッシュタグはリーチを削減する（未確認）',
      detail: '実験報告はあるがX公式は否定していない。アルゴリズムコード上は明示的なペナルティなし。',
      source: 'D (再現性低い)',
    },
    {
      rule: '最適投稿頻度（1日N件が良い）',
      detail: 'アカウント規模・ジャンルにより大きく異なる。公式な閾値は非公開。',
      source: '不明',
    },
  ],
};

function kbToText(): string {
  const scoring = X_ALGO_KB.scoring.map(r =>
    `  [${r.source}] ${r.rule}\n    詳細: ${r.detail}\n    運用含意: ${r.implication}`
  ).join('\n');
  const pipeline = X_ALGO_KB.pipeline.map(r =>
    `  [${r.source}] ${r.rule}\n    詳細: ${r.detail}\n    運用含意: ${r.implication}`
  ).join('\n');
  const nsfw = X_ALGO_KB.nsfw.map(r =>
    `  [${r.source}] ${r.rule}\n    詳細: ${r.detail}\n    運用含意: ${r.implication}`
  ).join('\n');
  const uncertain = X_ALGO_KB.uncertain.map(r =>
    `  [${r.source}] ${r.rule} ※未確認`
  ).join('\n');

  return `【Xアルゴリズム知識ベース (${X_ALGO_KB.version})】
出典凡例: A=公式OSSコード B=公式発言 C=公式Docs D=独立実験再現済み

■ スコアリングルール（確認済み）:
${scoring}

■ 配信パイプライン:
${pipeline}

■ センシティブコンテンツ特有:
${nsfw}

■ 未確認・議論中（参考のみ）:
${uncertain}`;
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

async function claudeAnalyze(statsText: string, kbText: string): Promise<string> {
  const client = getAnthropicClient();
  const res = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 2000,
    system: `あなたはXアルゴリズムの実証分析専門家です。
2段階の分析を行います:
① まず「理論層」: 知識ベースに記載された確認済みルールを列挙し、このアカウントの運用設計との整合性を評価する
② 次に「実データ層」: 実測値から帰納的な仮説を最大3つ提示する

厳守事項:
- 知識ベースのルールを引用する際は必ず出典記号[A/B/C/D]を付ける
- 実データから仮説を立てる際は必ずn数と具体的数値を引用する
- データがない事柄は「データ不足」と明記
- ハルシネーション厳禁`,
    messages: [{
      role: 'user',
      content: `${kbText}

---

${statsText}

---

上記の知識ベース（理論）と実データを統合して分析してください:

【理論層】知識ベースの各ルールが、このアカウントの現在の運用設計に対して「整合」「不整合」「不明（データ不足）」のどれかを評価

【実データ層】実測値から読み取れる仮説を3つ（各仮説: データ根拠→含意→信頼度）`,
    }],
  });
  return res.content[0].type === 'text' ? res.content[0].text : '';
}

async function o3Challenge(statsText: string, kbText: string, claudeHypothesis: string): Promise<string> {
  // o3はinternal reasoning（推論）に多くのトークンを使うため
  // max_completion_tokens は reasoning + 出力 合計のため余裕を持たせる
  // system roleはuser messageに統合（o3でのサポートが不安定なため）
  const systemContent = `あなたは統計的批判思考とXアルゴリズムの専門家です。以下の3点を行ってください:

① 【知識ベース検証】 Claudeが「整合」と評価したルールに本当に問題はないか？「不整合」と評価した点は本当に不整合か？知識ベースの出典信頼性自体も批判せよ。
② 【統計的批判】 実データ仮説の問題点（サンプルサイズ・シャドウバン交絡・選択バイアス等）を指摘し、代替仮説を提示せよ。
③ 【未知リスク】 Claudeが見落としている可能性のある要因を最大2つ指摘せよ。

批判は建設的・反証可能な形で。返答は日本語で。`;

  const userContent = `${systemContent}

===知識ベース===
${kbText}

===実データ===
${statsText}

===Claudeの仮説・理論評価===
${claudeHypothesis}

上記を批判的に検証してください。`;

  const res = await openai.chat.completions.create({
    model: 'o3',
    max_completion_tokens: 5000,  // reasoning込みで余裕を持たせる
    messages: [{ role: 'user', content: userContent }],
  });

  const content = res.choices[0]?.message?.content ?? '';
  if (!content) {
    const finishReason = res.choices[0]?.finish_reason;
    console.warn(`  ⚠ [o3] content空 (finish_reason=${finishReason}, usage=${JSON.stringify(res.usage)})`);
    return `[o3応答なし: finish_reason=${finishReason}]`;
  }
  console.log(`  ✅ [o3] 完了 (usage: reasoning=${(res.usage as any)?.completion_tokens_details?.reasoning_tokens ?? '?'} / output=${(res.usage as any)?.completion_tokens_details?.accepted_prediction_tokens ?? '?'})`);
  return content;
}

async function claudeSynthesize(
  statsText: string,
  kbText: string,
  claudeHypothesis: string,
  o3ChallengeText: string,
): Promise<string> {
  const client = getAnthropicClient();
  const res = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 1500,
    system: `あなたはXアルゴリズムの実証分析専門家です。知識ベース・実データ・o3の批判を統合して最終判断を出してください。
以下の構成で回答してください:
① 【更新された理論評価】: o3の指摘を受けて修正した、各ルールの整合性判定
② 【採用・棄却した仮説】: o3の批判で認めた点と、根拠付きで維持する点
③ 【今週のアクションプラン】: 3つ以内・具体的・測定可能な行動`,
    messages: [{
      role: 'user',
      content: `${kbText}\n\n---\n\n【データ】\n${statsText}\n\n【当初分析（Claude）】\n${claudeHypothesis}\n\n【o3の批判】\n${o3ChallengeText}\n\n最終統合分析とアクションプランを出してください。`,
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
  const kbText    = kbToText();
  console.log('  🧠 [Claude] 理論評価 + 仮説生成中...');
  const hypothesis = await claudeAnalyze(statsText, kbText);

  console.log('  🤖 [o3] 知識ベース検証 + 批判的検証中...');
  const challenge = await o3Challenge(statsText, kbText, hypothesis);

  console.log('  🧠 [Claude] 統合・アクションプラン生成中...');
  const synthesis = await claudeSynthesize(statsText, kbText, hypothesis, challenge);

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
