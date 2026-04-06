/**
 * meeting.ts — 3者会議室
 *
 * 参加者：
 *   - GPT-4o          (調査・リサーチ担当)
 *   - Claude Sonnet   (実装・判断担当)
 *   - あなた           (意思決定者)
 *
 * フロー：
 *   Deep Research → 3者議論 → 決定事項抽出 → 保存・全体反映
 */

import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { readJson, writeJson } from './cloudStore.js';
import { getAllPosts, getStats, getExternalPatternsInfo, getDailyImpressionSnapshots, getObservations } from './storage.js';
import { getStrategySummary } from './strategy.js';

// ─── クライアント初期化 ──────────────────────────────────────────────────────

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const anthropic = new Anthropic({
  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY ?? 'dummy',
  baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
});

// ─── 型定義 ──────────────────────────────────────────────────────────────────

export interface ResearchSession {
  id: string;
  topic: string;
  result: string;
  model: string;
  startedAt: string;
  completedAt: string;
}

export type Speaker = 'user' | 'gpt' | 'claude' | 'system';

export interface MeetingMessage {
  role: 'user' | 'assistant';
  speaker: Speaker;
  content: string;
  at: string;
}

export interface DecisionCandidate {
  id: string;
  text: string;
  category: MeetingDirective['category'];
  priority: MeetingDirective['priority'];
  rationale: string;
}

export interface MeetingSession {
  id: string;
  title: string;
  createdAt: string;
  messages: MeetingMessage[];
  researchId?: string;
  decisionCandidates?: DecisionCandidate[];
}

export interface MeetingDirective {
  id: string;
  text: string;
  category: 'strategy' | 'content' | 'timing' | 'recovery' | 'other';
  priority: 'high' | 'medium' | 'low';
  status: 'active' | 'completed' | 'cancelled';
  source: string;
  createdAt: string;
  updatedAt: string;
}

interface MeetingData {
  researches: ResearchSession[];
  meetings: MeetingSession[];
  directives: MeetingDirective[];
}

const DEFAULT_DATA: MeetingData = { researches: [], meetings: [], directives: [] };

// ─── インメモリキャッシュ ─────────────────────────────────────────────────────

let cache: MeetingData = { ...DEFAULT_DATA };

export async function loadMeetingData(): Promise<void> {
  cache = await readJson<MeetingData>('meeting-data.json', DEFAULT_DATA);
  if (!cache.directives) cache.directives = [];
  // 旧形式(speaker なし)のメッセージを移行
  for (const s of cache.meetings) {
    for (const m of s.messages) {
      if (!m.speaker) {
        (m as any).speaker = m.role === 'user' ? 'user' : 'gpt';
      }
    }
  }
  const active = cache.directives.filter((d) => d.status === 'active').length;
  if (cache.directives.length > 0 || cache.meetings.length > 0) {
    console.log(`  🤝 会議室: リサーチ${cache.researches.length}件 / 会議${cache.meetings.length}件 / 決定事項${active}件アクティブ`);
  }
}

async function saveData(): Promise<void> {
  await writeJson('meeting-data.json', cache);
}

// ─── ボット現状コンテキスト ───────────────────────────────────────────────────

export function buildBotContext(): string {
  const stats = getStats();
  const strategy = getStrategySummary();
  const extInfo = getExternalPatternsInfo();
  const posts = getAllPosts();
  const snapshots = getDailyImpressionSnapshots(14);
  const observations = getObservations().slice(-10);
  const activeDirectives = cache.directives.filter((d) => d.status === 'active');

  const recentPosts = posts.slice(-20).reverse().map((p) => {
    const m = p.metrics;
    const imp = m?.impression_count ?? '未計測';
    const like = m?.like_count ?? 0;
    const rt = m?.retweet_count ?? 0;
    const bm = m?.bookmark_count ?? 0;
    const score = m ? like + rt * 3 + bm * 2 + (m.reply_count || 0) : 0;
    const date = new Date(p.postedAt).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric' });
    return `  - [${p.type}] ${date} | インプ:${imp} | ❤${like} RT:${rt} 🔖${bm} | スコア:${score} | ${p.text?.slice(0, 50) ?? ''}`;
  }).join('\n');

  let snapshotSummary = '  データなし';
  if (snapshots.length > 0) {
    snapshotSummary = snapshots.map((s) =>
      `  ${s.date}: 平均${s.avgImpressions.toFixed(1)}インプ (${s.postsChecked}件)`
    ).join('\n');
    if (snapshots.length >= 2) {
      const trend = snapshots[snapshots.length - 1].avgImpressions - snapshots[0].avgImpressions;
      snapshotSummary += `\n  トレンド: ${trend >= 0 ? '↑' : '↓'} ${Math.abs(trend).toFixed(1)} (${snapshots.length}日)`;
    }
  }

  const topExt = (extInfo.topPatterns ?? []).slice(0, 5).map((p: any) =>
    `  - スコア:${p.score} | ❤${p.like_count} RT:${p.retweet_count} | ${p.text?.slice(0, 60) ?? ''}`
  ).join('\n') || '  データなし';

  const hypotheses = (strategy.hypotheses ?? []).map((h: any) => {
    const icon = h.status === 'confirmed' ? '✅' : h.status === 'adjusted' ? '🔧' : h.status === 'rejected' ? '❌' : '⏳';
    return `  ${icon} [${h.id}] ${h.question} → ${h.finding}`;
  }).join('\n') || '  データなし';

  const obsSummary = observations.map((o: any) =>
    `  [${o.category}/${o.priority}] ${o.observation}${o.hypothesis ? ' → ' + o.hypothesis : ''}`
  ).join('\n') || '  なし';

  const dirSummary = activeDirectives.length > 0
    ? activeDirectives.map((d) => `  【${d.priority}/${d.category}】${d.text}`).join('\n')
    : '  なし';

  return `## ボット現状（${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}）

### アカウント
- @suguhalove0419 / シャドウバン回復中 / フォロワー約341人
- 投稿モード: 1日2件（10:30 インプ狙い / 20:00 芸能人アフィリ）
- 統計: 総投稿${stats.totalPosts}件 / 直近7日${stats.postsLast7Days}件 / いいね${stats.totalLikes}

### インプレッション推移（直近14日）
${snapshotSummary}

### 直近20件の投稿
${recentPosts || '  データなし'}

### 外部パターン高スコアTOP5
${topExt}

### 戦略仮説
${hypotheses}

### 観察ログ
${obsSummary}

### アクティブ決定事項
${dirSummary}`.trim();
}

// ─── Deep Research (GPT-4o + web search) ────────────────────────────────────

export async function runDeepResearch(topic: string): Promise<ResearchSession> {
  const startedAt = new Date().toISOString();
  const id = `research-${Date.now()}`;
  const botContext = buildBotContext();

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-search-preview',
    web_search_options: {},
    messages: [
      {
        role: 'system',
        content: `あなたは日本語Xアフィリエイトマーケティングのリサーチ専門家です。ウェブ検索で最新情報を調査してください。
${botContext}
この情報を踏まえ、具体的数字と行動指針を含む実用的な回答を日本語でしてください。
また、会議の参加者であるClaudeが実装の観点から議論しやすいよう、論点を明確に整理してください。`,
      },
      { role: 'user', content: `調査テーマ：\n\n${topic}` },
    ],
  } as any);

  const result = response.choices[0]?.message?.content ?? '（応答なし）';
  const completedAt = new Date().toISOString();
  const session: ResearchSession = { id, topic, result, model: response.model, startedAt, completedAt };

  cache.researches.unshift(session);
  cache.researches = cache.researches.slice(0, 20);
  await saveData();
  return session;
}

// ─── 発言ヘルパー ──────────────────────────────────────────────────────────

function getResearchContext(session: MeetingSession): string {
  if (!session.researchId) return '';
  const r = cache.researches.find((x) => x.id === session.researchId);
  return r ? `\n\n## 関連リサーチ（${r.topic}）\n${r.result.slice(0, 2500)}` : '';
}

function buildHistory(messages: MeetingMessage[]): string {
  return messages.slice(-20).map((m) => {
    const label = m.speaker === 'gpt' ? 'o3 Thinking(GPT)' : m.speaker === 'claude' ? 'Claude Sonnet' : m.speaker === 'user' ? 'ユーザー' : 'システム';
    return `[${label}] ${m.content}`;
  }).join('\n\n---\n\n');
}

// o3 Thinking に発言させる（推論モデル）
async function speakAsGPT(session: MeetingSession, prompt: string, extraInstruction = ''): Promise<string> {
  const botContext = buildBotContext();
  const researchCtx = getResearchContext(session);
  const history = session.messages.length > 0 ? `\n\n## これまでの議論\n${buildHistory(session.messages)}` : '';

  const systemContent = `あなたはFANZA XボットのAI戦略アドバイザー（o3 Thinking）として3者会議に参加しています。
役割：リサーチ・データ分析・外部トレンドの視点から論理的かつ具体的に意見を述べる。
Claudeとは対等な議論パートナーとして、相手の意見に合意・反論・修正を明確に示してください。
${botContext}${researchCtx}${history}
${extraInstruction}
重要な合意点や提案は「📌 決定候補:」と明記してください。日本語で回答してください。`;

  const response = await openai.chat.completions.create({
    model: 'o3',
    messages: [
      { role: 'system', content: systemContent },
      { role: 'user', content: prompt },
    ],
    max_completion_tokens: 2000,
  } as any);

  return response.choices[0]?.message?.content ?? '（応答なし）';
}

// Claude Sonnet に発言させる
async function speakAsClaude(session: MeetingSession, prompt: string, extraInstruction = ''): Promise<string> {
  const botContext = buildBotContext();
  const researchCtx = getResearchContext(session);
  const history = session.messages.length > 0 ? `\n\n## これまでの議論\n${buildHistory(session.messages)}` : '';

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2000,
    system: `あなたはFANZA XボットのAIアドバイザー（Claude Sonnet）として3者会議に参加しています。
役割：実装可能性・リスク評価・具体的な実行プランの視点から意見を述べる。
o4-miniとは対等な議論パートナーとして、相手の意見に合意・反論・修正を明確に示してください。
${botContext}${researchCtx}${history}
${extraInstruction}
重要な合意点や提案は「📌 決定候補:」と明記してください。日本語で回答してください。`,
    messages: [{ role: 'user', content: prompt }],
  });

  const block = response.content[0];
  return block.type === 'text' ? block.text : '（応答なし）';
}

// ─── 会議セッション作成・通常メッセージ ────────────────────────────────────

export async function createMeetingSession(title: string, researchId?: string): Promise<MeetingSession> {
  const session: MeetingSession = {
    id: `meeting-${Date.now()}`,
    title,
    createdAt: new Date().toISOString(),
    messages: [],
    researchId,
  };
  cache.meetings.unshift(session);
  cache.meetings = cache.meetings.slice(0, 10);
  await saveData();
  return session;
}

function pushMsg(session: MeetingSession, speaker: Speaker, content: string): MeetingMessage {
  const msg: MeetingMessage = {
    role: speaker === 'user' ? 'user' : 'assistant',
    speaker,
    content,
    at: new Date().toISOString(),
  };
  session.messages.push(msg);
  return msg;
}

// GPTへのメッセージ送信
export async function sendToGPT(sessionId: string, userMessage: string): Promise<MeetingMessage> {
  const session = cache.meetings.find((m) => m.id === sessionId);
  if (!session) throw new Error(`会議が見つかりません: ${sessionId}`);
  pushMsg(session, 'user', userMessage);
  const reply = await speakAsGPT(session, userMessage);
  const msg = pushMsg(session, 'gpt', reply);
  await saveData();
  return msg;
}

// Claudeへのメッセージ送信
export async function sendToClaude(sessionId: string, userMessage: string): Promise<MeetingMessage> {
  const session = cache.meetings.find((m) => m.id === sessionId);
  if (!session) throw new Error(`会議が見つかりません: ${sessionId}`);
  pushMsg(session, 'user', userMessage);
  const reply = await speakAsClaude(session, userMessage);
  const msg = pushMsg(session, 'claude', reply);
  await saveData();
  return msg;
}

// ─── 3者会議モード（2ラウンドディベート）────────────────────────────────

export type TrialogueResult = {
  gptMsg1: MeetingMessage;
  claudeMsg1: MeetingMessage;
  gptMsg2: MeetingMessage;
  claudeMsg2: MeetingMessage;
};

export async function runTrialogue(
  sessionId: string,
  userMessage: string,
): Promise<TrialogueResult> {
  const session = cache.meetings.find((m) => m.id === sessionId);
  if (!session) throw new Error(`会議が見つかりません: ${sessionId}`);

  pushMsg(session, 'user', userMessage);

  // ── ラウンド1: GPT が調査・データ観点で先手を打つ ──
  const gptReply1 = await speakAsGPT(
    session,
    `【議題】${userMessage}\n\nリサーチ・データ・外部トレンドの観点から先に意見を述べてください。論点を明確に整理し、Claudeが反論・補足しやすいよう構造化してください。`,
    `【ラウンド1 - GPT先手】あなたが最初に発言します。データと外部事例を根拠に、具体的な立場を取ってください。曖昧な表現は避け、賛否・強弱・優先度を明示してください。`,
  );
  const gptMsg1 = pushMsg(session, 'gpt', gptReply1);

  // ── ラウンド1: Claude が GPT の意見に反論・補完 ──
  const claudeReply1 = await speakAsClaude(
    session,
    `GPTが以下のように述べました：\n\n${gptReply1}\n\n---\n元の議題：${userMessage}\n\nGPTの主張を批判的に検討してください。同意できる点・反論すべき点・見落としている点を明確に示してください。`,
    `【ラウンド1 - Claude反論/補完】GPTの主張に対して積極的に議論してください。単なる補完ではなく、実装リスク・現実的制約の観点からGPTの意見に挑戦してください。重要な対立点があれば明示してください。`,
  );
  const claudeMsg1 = pushMsg(session, 'claude', claudeReply1);

  // ── ラウンド2: GPT が Claude の反論を受けて立場を再表明・修正 ──
  const gptReply2 = await speakAsGPT(
    session,
    `Claudeが以下のように反論・補完しました：\n\n${claudeReply1}\n\n---\n元の議題：${userMessage}\n\nClaudeの指摘を受けて、自分の立場を再検討してください。同意できる点は認め、譲れない点は根拠を補強して主張してください。`,
    `【ラウンド2 - GPT再反論/修正】Claudeの指摘を受けた上で、あなたの最終的な立場を示してください。部分的に修正した場合はその理由を述べ、合意できた点と対立点を整理してください。ユーザーが判断しやすいよう論点を絞ってください。`,
  );
  const gptMsg2 = pushMsg(session, 'gpt', gptReply2);

  // ── ラウンド2: Claude が最終統合・決定候補を提示 ──
  const claudeReply2 = await speakAsClaude(
    session,
    `2ラウンドの議論を経て、GPTが以下のように再発言しました：\n\n${gptReply2}\n\n---\n元の議題：${userMessage}\n\n議論全体を踏まえ、最終的な統合見解と、ユーザーが決断すべき選択肢を整理してください。`,
    `【ラウンド2 - Claude最終統合】2ラウンドの議論を総括してください。①合意できた点、②残る対立点、③ユーザーへの決断を求める選択肢（A案/B案など）、④推奨案とその根拠 を必ず含めてください。「📌 決定候補:」を使って具体的な実行項目を3〜5件提案してください。`,
  );
  const claudeMsg2 = pushMsg(session, 'claude', claudeReply2);

  await saveData();
  return { gptMsg1, claudeMsg1, gptMsg2, claudeMsg2 };
}

// ─── 決定事項自動抽出 ────────────────────────────────────────────────────────

export async function extractDecisions(sessionId: string): Promise<DecisionCandidate[]> {
  const session = cache.meetings.find((m) => m.id === sessionId);
  if (!session) throw new Error(`会議が見つかりません: ${sessionId}`);
  if (session.messages.length < 2) return [];

  const transcript = buildHistory(session.messages);
  const botContext = buildBotContext();

  const prompt = `以下はFANZA Xボット運営に関する3者会議（GPT-4o・Claude・ユーザー）の議事録です。

${botContext}

## 議事録
${transcript}

---
この会議で合意・提案された「具体的な行動決定事項」を3〜6件抽出し、以下のJSON配列形式で返してください。
必ず有効なJSONのみ返し、コードブロックやコメントは含めないでください。

[
  {
    "text": "決定事項の本文（具体的に・実行可能な形で）",
    "category": "strategy|content|timing|recovery|other のいずれか",
    "priority": "high|medium|low のいずれか",
    "rationale": "この決定の根拠（1〜2文）"
  }
]`;

  let jsonText = '';
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    });
    const block = response.content[0];
    jsonText = block.type === 'text' ? block.text.trim() : '[]';

    // JSON部分を抽出
    const match = jsonText.match(/\[[\s\S]*\]/);
    if (!match) return [];

    const parsed = JSON.parse(match[0]) as any[];
    const candidates: DecisionCandidate[] = parsed.map((item, i) => ({
      id: `candidate-${Date.now()}-${i}`,
      text: String(item.text ?? ''),
      category: (['strategy', 'content', 'timing', 'recovery', 'other'].includes(item.category)
        ? item.category : 'other') as MeetingDirective['category'],
      priority: (['high', 'medium', 'low'].includes(item.priority)
        ? item.priority : 'medium') as MeetingDirective['priority'],
      rationale: String(item.rationale ?? ''),
    })).filter((c) => c.text.length > 0);

    // セッションに保存
    session.decisionCandidates = candidates;
    await saveData();
    return candidates;
  } catch (e: any) {
    console.error('  ❌ 決定事項抽出エラー:', e.message, jsonText.slice(0, 200));
    return [];
  }
}

// ─── Directives CRUD ─────────────────────────────────────────────────────────

export async function addDirective(
  text: string,
  category: MeetingDirective['category'],
  priority: MeetingDirective['priority'],
  source: string,
): Promise<MeetingDirective> {
  const now = new Date().toISOString();
  const directive: MeetingDirective = {
    id: `dir-${Date.now()}`,
    text, category, priority,
    status: 'active',
    source,
    createdAt: now,
    updatedAt: now,
  };
  cache.directives.unshift(directive);
  await saveData();
  console.log(`  📌 決定事項保存 [${category}/${priority}]: ${text.slice(0, 60)}`);
  return directive;
}

export function getDirectives(): MeetingDirective[] {
  return cache.directives;
}

export function getActiveDirectives(): MeetingDirective[] {
  return cache.directives.filter((d) => d.status === 'active');
}

export async function updateDirectiveStatus(id: string, status: MeetingDirective['status']): Promise<MeetingDirective | null> {
  const d = cache.directives.find((x) => x.id === id);
  if (!d) return null;
  d.status = status;
  d.updatedAt = new Date().toISOString();
  await saveData();
  return d;
}

// ─── データ取得 ────────────────────────────────────────────────────────────

export function getResearches(): ResearchSession[] { return cache.researches; }
export function getMeetings(): MeetingSession[] { return cache.meetings; }
export function getMeetingById(id: string): MeetingSession | undefined {
  return cache.meetings.find((m) => m.id === id);
}
