/**
 * meeting.ts
 * GPT-4o を使った「会議室」機能
 * - Deep Research: gpt-4o-search-preview でリアルタイムウェブ検索＋分析
 * - Meeting Chat: gpt-4o でボット現状データを踏まえた戦略議論
 */

import OpenAI from 'openai';
import { readJson, writeJson } from './cloudStore.js';
import { getAllPosts, getStats, getExternalPatternsInfo } from './storage.js';
import { getStrategySummary } from './strategy.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─── 型定義 ──────────────────────────────────────────────────────────────────

export interface ResearchSession {
  id: string;
  topic: string;
  result: string;
  model: string;
  startedAt: string;
  completedAt: string;
}

export interface MeetingMessage {
  role: 'user' | 'assistant';
  content: string;
  at: string;
}

export interface MeetingSession {
  id: string;
  title: string;
  createdAt: string;
  messages: MeetingMessage[];
  researchId?: string;
}

interface MeetingData {
  researches: ResearchSession[];
  meetings: MeetingSession[];
}

const DEFAULT_DATA: MeetingData = { researches: [], meetings: [] };

// ─── インメモリキャッシュ ─────────────────────────────────────────────────────

let cache: MeetingData = { ...DEFAULT_DATA };

export async function loadMeetingData(): Promise<void> {
  cache = await readJson<MeetingData>('meeting-data.json', DEFAULT_DATA);
}

async function saveData(): Promise<void> {
  await writeJson('meeting-data.json', cache);
}

// ─── ボット現状コンテキスト生成 ───────────────────────────────────────────────

function buildBotContext(): string {
  const stats = getStats();
  const strategy = getStrategySummary();
  const extInfo = getExternalPatternsInfo();
  const posts = getAllPosts().slice(-10);

  const recentPostsSummary = posts.map((p) => {
    const m = p.metrics;
    const score = m ? (m.like_count || 0) + (m.retweet_count || 0) * 3 + (m.bookmark_count || 0) * 2 + (m.reply_count || 0) : 0;
    return `  - [${p.type}] ${new Date(p.postedAt).toLocaleDateString('ja-JP')} / スコア:${score} / ${p.text?.slice(0, 40) ?? ''}...`;
  }).join('\n');

  const hypothesesSummary = (strategy.hypotheses ?? []).map((h: any) => {
    const icon = h.status === 'confirmed' ? '✅' : h.status === 'adjusted' ? '🔧' : h.status === 'rejected' ? '❌' : '⏳';
    return `  ${icon} ${h.question} → ${h.finding}`;
  }).join('\n');

  return `
## 現在のボット状態（${new Date().toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' })} 時点）

### アカウント概要
- アカウント: @suguhalove0419
- 状態: シャドウバン回復中（インプレッション 4〜17件/投稿）
- フォロワー: 約341人
- 投稿モード: 1日2件体制（10:30 インプ狙い / 20:00 芸能人アフィリ）

### 統計
- 総投稿数: ${stats.totalPosts}件
- 今週: ${stats.postsLast7Days}件
- 累計いいね: ${stats.totalLikes}
- 外部パターン収集数: ${extInfo.count}件

### 直近10件の投稿
${recentPostsSummary || '  データなし'}

### 戦略エンジンの仮説状態
${hypothesesSummary || '  データなし'}
`.trim();
}

// ─── Deep Research ─────────────────────────────────────────────────────────

export async function runDeepResearch(topic: string): Promise<ResearchSession> {
  const startedAt = new Date().toISOString();
  const id = `research-${Date.now()}`;

  const botContext = buildBotContext();

  const systemPrompt = `あなたは日本語のXアフィリエイトマーケティングの専門アドバイザーです。
ユーザーはFANZA（成人向けアフィリエイト）のXボットを運営しており、現在シャドウバンからの回復中です。
以下はボットの現状データです：

${botContext}

この情報を踏まえて、ユーザーのリサーチ要求に対して：
1. 最新の情報・事例を調査して提示する
2. このボットの状況に即した具体的なアドバイスを提供する
3. 日本語で、明確で実用的な回答をする
4. 数字や具体的な行動指針を含める`;

  const userMessage = `次のテーマについて詳しく調査・分析してください：\n\n${topic}`;

  // gpt-4o-search-preview: ウェブ検索付きモデル
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-search-preview',
    web_search_options: {},
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
  } as any);

  const result = response.choices[0]?.message?.content ?? '（応答なし）';
  const completedAt = new Date().toISOString();

  const session: ResearchSession = {
    id,
    topic,
    result,
    model: response.model,
    startedAt,
    completedAt,
  };

  cache.researches.unshift(session);
  cache.researches = cache.researches.slice(0, 20); // 最新20件のみ保持
  await saveData();

  return session;
}

// ─── Meeting Chat ──────────────────────────────────────────────────────────

export async function createMeetingSession(title: string, researchId?: string): Promise<MeetingSession> {
  const session: MeetingSession = {
    id: `meeting-${Date.now()}`,
    title,
    createdAt: new Date().toISOString(),
    messages: [],
    researchId,
  };

  cache.meetings.unshift(session);
  cache.meetings = cache.meetings.slice(0, 10); // 最新10件
  await saveData();

  return session;
}

export async function sendMeetingMessage(
  sessionId: string,
  userMessage: string,
): Promise<MeetingMessage> {
  const session = cache.meetings.find((m) => m.id === sessionId);
  if (!session) throw new Error(`会議セッションが見つかりません: ${sessionId}`);

  const botContext = buildBotContext();

  // 関連リサーチがあれば追加
  let researchContext = '';
  if (session.researchId) {
    const research = cache.researches.find((r) => r.id === session.researchId);
    if (research) {
      researchContext = `\n\n## 関連リサーチ結果（${research.topic}）\n${research.result.slice(0, 2000)}...`;
    }
  }

  const systemPrompt = `あなたはFANZA XアフィリエイトボットのAI戦略アドバイザーです。
ユーザーはこのボットのオーナーで、シャドウバン回復後の収益化を目指しています。

${botContext}${researchContext}

会議のルール：
- 実際のデータと現状に基づいて回答する
- 具体的・実用的なアドバイスを優先する
- 実装可能な提案をする（コードはClaudeが担当）
- 結論・行動指針を明確に示す
- 日本語で回答する`;

  // 会話履歴を構築
  const history: OpenAI.ChatCompletionMessageParam[] = session.messages.slice(-10).map((m) => ({
    role: m.role,
    content: m.content,
  }));

  history.push({ role: 'user', content: userMessage });

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: systemPrompt },
      ...history,
    ],
    temperature: 0.7,
    max_tokens: 1500,
  });

  const assistantContent = response.choices[0]?.message?.content ?? '（応答なし）';

  const userMsg: MeetingMessage = { role: 'user', content: userMessage, at: new Date().toISOString() };
  const assistantMsg: MeetingMessage = { role: 'assistant', content: assistantContent, at: new Date().toISOString() };

  session.messages.push(userMsg, assistantMsg);
  await saveData();

  return assistantMsg;
}

// ─── データ取得 ────────────────────────────────────────────────────────────

export function getResearches(): ResearchSession[] {
  return cache.researches;
}

export function getMeetings(): MeetingSession[] {
  return cache.meetings;
}

export function getMeetingById(id: string): MeetingSession | undefined {
  return cache.meetings.find((m) => m.id === id);
}
