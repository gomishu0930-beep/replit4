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

export type Assignee = 'user' | 'others' | 'ai';

export interface DecisionCandidate {
  id: string;
  text: string;
  category: MeetingDirective['category'];
  priority: MeetingDirective['priority'];
  rationale: string;
  assignee: Assignee;
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
  assignee: Assignee;
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

// ─── 3者会議モード（5ラウンドディベート）────────────────────────────────

const TOTAL_ROUNDS = 5;

// ラウンドごとのGPT指示
function gptRoundInstruction(round: number, total: number): string {
  if (round === 1) {
    return `【ラウンド${round}/${total} - 立論】あなたが最初に発言します。データと外部事例を根拠に明確な立場を示してください。論点を箇条書きで整理し、Claudeが反論しやすいよう構造化してください。`;
  }
  if (round === total) {
    return `【ラウンド${round}/${total} - 最終立場】これが最後の発言です。これまでの議論を経て修正された立場を簡潔に示してください。Claudeへの最終的な問いかけや提案があれば添えてください。`;
  }
  return `【ラウンド${round}/${total} - 再論】Claudeの指摘を受けて立場を再検討してください。認める点は明示し、譲れない点は根拠を補強して主張してください。論点を絞って簡潔に。`;
}

// ラウンドごとのClaude指示
function claudeRoundInstruction(round: number, total: number): string {
  if (round === total) {
    return `【ラウンド${round}/${total} - 最終統合】${total}ラウンドの議論全体を総括してください。①合意した点、②残る対立点、③ユーザーへの選択肢（A案/B案など）、④推奨案と根拠 を必ず含めてください。「📌 決定候補:」を使って実行項目を3〜5件提案してください。`;
  }
  return `【ラウンド${round}/${total} - 反論/補完】GPTの主張を批判的に検討してください。同意できる点を明示しつつ、実装リスク・現実的制約・見落としの観点から反論してください。新たな論点があれば提示してください。`;
}

export async function runTrialogue(
  sessionId: string,
  userMessage: string,
): Promise<{ messages: MeetingMessage[] }> {
  const session = cache.meetings.find((m) => m.id === sessionId);
  if (!session) throw new Error(`会議が見つかりません: ${sessionId}`);

  pushMsg(session, 'user', userMessage);

  const newMessages: MeetingMessage[] = [];
  let lastGptReply = '';
  let lastClaudeReply = '';

  for (let round = 1; round <= TOTAL_ROUNDS; round++) {
    // ── GPT発言 ──
    const gptPrompt = round === 1
      ? `【議題】${userMessage}\n\nリサーチ・データ・外部トレンドの観点から先に意見を述べてください。論点を明確に整理し、Claudeが反論しやすいよう構造化してください。`
      : `Claudeが以下のように述べました：\n\n${lastClaudeReply}\n\n---\n元の議題：${userMessage}\n\nClaudeの指摘を受けて立場を再検討し、返答してください。`;

    const gptReply = await speakAsGPT(session, gptPrompt, gptRoundInstruction(round, TOTAL_ROUNDS));
    const gptMsg = pushMsg(session, 'gpt', gptReply);
    newMessages.push(gptMsg);
    lastGptReply = gptReply;

    // ── Claude発言 ──
    const claudePrompt = round === TOTAL_ROUNDS
      ? `${TOTAL_ROUNDS}ラウンドの議論を経て、GPTが最終的に以下のように述べました：\n\n${gptReply}\n\n---\n元の議題：${userMessage}\n\n議論全体を踏まえた最終統合見解とユーザーへの決断材料を提示してください。`
      : `GPTが以下のように述べました（ラウンド${round}）：\n\n${gptReply}\n\n---\n元の議題：${userMessage}\n\nGPTの主張を批判的に検討し、返答してください。`;

    const claudeReply = await speakAsClaude(session, claudePrompt, claudeRoundInstruction(round, TOTAL_ROUNDS));
    const claudeMsg = pushMsg(session, 'claude', claudeReply);
    newMessages.push(claudeMsg);
    lastClaudeReply = claudeReply;
  }

  await saveData();
  return { messages: newMessages };
}

// ─── 決定事項自動抽出 ────────────────────────────────────────────────────────

export async function extractDecisions(sessionId: string): Promise<DecisionCandidate[]> {
  const session = cache.meetings.find((m) => m.id === sessionId);
  if (!session) throw new Error(`会議が見つかりません: ${sessionId}`);
  if (session.messages.length < 2) return [];

  const transcript = buildHistory(session.messages);
  const botContext = buildBotContext();

  const prompt = `以下はFANZA Xボット運営に関する3者会議（o3 Thinking・Claude・ユーザー）の議事録です。

${botContext}

## 議事録
${transcript}

---
この会議で合意・提案された「具体的な行動決定事項」を3〜6件抽出し、以下のJSON配列形式で返してください。
必ず有効なJSONのみ返し、コードブロックやコメントは含めないでください。

assignee の分類基準：
- "user"   : ユーザー本人（アカウントオーナー）が手動で行うこと
- "others" : 外部の人・サービス・パートナーが行うこと（または外部環境の変化に依存）
- "ai"     : ボット（AI）が自動で実行・監視・生成すること

[
  {
    "text": "決定事項の本文（具体的に・実行可能な形で）",
    "category": "strategy|content|timing|recovery|other のいずれか",
    "priority": "high|medium|low のいずれか",
    "rationale": "この決定の根拠（1〜2文）",
    "assignee": "user|others|ai のいずれか"
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
      assignee: (['user', 'others', 'ai'].includes(item.assignee)
        ? item.assignee : 'user') as Assignee,
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
  assignee: Assignee = 'user',
): Promise<MeetingDirective> {
  const now = new Date().toISOString();
  const directive: MeetingDirective = {
    id: `dir-${Date.now()}`,
    text, category, priority,
    status: 'active',
    assignee,
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

// ─── Q&Aラウンド（5ラウンドディベート後のユーザー質問）─────────────────

export async function runQARound(
  sessionId: string,
  userMessage: string,
): Promise<{ gptMsg: MeetingMessage; claudeMsg: MeetingMessage }> {
  const session = cache.meetings.find((m) => m.id === sessionId);
  if (!session) throw new Error(`会議が見つかりません: ${sessionId}`);

  pushMsg(session, 'user', userMessage);

  // o3 がユーザーの質問に直接回答
  const gptReply = await speakAsGPT(
    session,
    userMessage,
    `【Q&Aラウンド - o3】ユーザーからの質問に直接・具体的に答えてください。
これまでのディベートの文脈を踏まえながら、データ・リサーチの観点で明確な回答を出してください。
もし立場を変える場合はその理由も述べてください。`,
  );
  const gptMsg = pushMsg(session, 'gpt', gptReply);

  // Claude がo3の回答も参照しつつユーザーの質問に回答
  const claudeReply = await speakAsClaude(
    session,
    `ユーザーの質問：\n${userMessage}\n\no3の回答：\n${gptReply}\n\n---\nユーザーの質問に対して、実装・リスク・実行プランの観点から回答してください。o3と異なる見解がある場合は明確に示し、補完・修正してください。`,
    `【Q&Aラウンド - Claude】ユーザーの質問への直接回答を優先してください。o3の回答で不十分な点があれば補完し、矛盾があれば指摘してください。実施すべきこと（誰が・何を・いつ）を明確にしてください。`,
  );
  const claudeMsg = pushMsg(session, 'claude', claudeReply);

  await saveData();
  return { gptMsg, claudeMsg };
}

// ─── データ取得 ────────────────────────────────────────────────────────────

export function getResearches(): ResearchSession[] { return cache.researches; }
export function getMeetings(): MeetingSession[] { return cache.meetings; }
export function getMeetingById(id: string): MeetingSession | undefined {
  return cache.meetings.find((m) => m.id === id);
}
