/**
 * meeting.ts
 * GPT-4o を使った「会議室」機能
 * - Deep Research: gpt-4o-search-preview でリアルタイムウェブ検索＋分析
 * - Meeting Chat: gpt-4o でボット現状データを踏まえた戦略議論
 * - Directives: 会議で決定した施策をGCS永続化し、全体に反映
 */

import OpenAI from 'openai';
import { readJson, writeJson } from './cloudStore.js';
import { getAllPosts, getStats, getExternalPatternsInfo, getDailyImpressionSnapshots, getObservations } from './storage.js';
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

export interface MeetingDirective {
  id: string;
  text: string;               // 決定事項の本文
  category: 'strategy' | 'content' | 'timing' | 'recovery' | 'other';
  priority: 'high' | 'medium' | 'low';
  status: 'active' | 'completed' | 'cancelled';
  source: string;             // 由来（会議タイトルやリサーチトピック）
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
  const active = cache.directives.filter((d) => d.status === 'active').length;
  if (cache.directives.length > 0) {
    console.log(`  🤝 会議室データ読み込み: リサーチ${cache.researches.length}件 / 会議${cache.meetings.length}件 / 決定事項${active}件アクティブ`);
  }
}

async function saveData(): Promise<void> {
  await writeJson('meeting-data.json', cache);
}

// ─── ボット現状コンテキスト生成（会議に渡す全データ）─────────────────────────

export function buildBotContext(): string {
  const stats = getStats();
  const strategy = getStrategySummary();
  const extInfo = getExternalPatternsInfo();
  const posts = getAllPosts();
  const snapshots = getDailyImpressionSnapshots(14);
  const observations = getObservations().slice(-10);
  const activeDirectives = cache.directives.filter((d) => d.status === 'active');

  // ── 直近20件の投稿詳細 ──
  const recentPosts = posts.slice(-20).reverse();
  const recentPostsSummary = recentPosts.map((p) => {
    const m = p.metrics;
    const imp = m?.impression_count ?? '未計測';
    const like = m?.like_count ?? 0;
    const rt = m?.retweet_count ?? 0;
    const bm = m?.bookmark_count ?? 0;
    const score = m ? like + rt * 3 + bm * 2 + (m.reply_count || 0) : 0;
    const date = new Date(p.postedAt).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric' });
    return `  - [${p.type}] ${date} | インプ:${imp} | ❤${like} RT:${rt} 🔖${bm} | スコア:${score} | ${p.text?.slice(0, 50) ?? ''}`;
  }).join('\n');

  // ── 回復スナップショット（日次インプレッション推移） ──
  let snapshotSummary = '  データなし';
  if (snapshots.length > 0) {
    snapshotSummary = snapshots.map((s) =>
      `  ${s.date}: 平均${s.avgImpressions.toFixed(1)}インプ (${s.postsChecked}件計測)`
    ).join('\n');
    const trend = snapshots.length >= 2
      ? snapshots[snapshots.length - 1].avgImpressions - snapshots[0].avgImpressions
      : 0;
    snapshotSummary += `\n  トレンド: ${trend >= 0 ? '↑' : '↓'} ${Math.abs(trend).toFixed(1)}インプ (${snapshots.length}日間)`;
  }

  // ── 外部パターンTOP5（高スコア事例） ──
  const topExt = (extInfo.topPatterns ?? []).slice(0, 5);
  const extSummary = topExt.length > 0
    ? topExt.map((p: any) =>
        `  - スコア:${p.score} | ❤${p.like_count} RT:${p.retweet_count} | ${p.text?.slice(0, 60) ?? ''}`
      ).join('\n')
    : '  データなし';

  // ── 仮説状態 ──
  const hypothesesSummary = (strategy.hypotheses ?? []).map((h: any) => {
    const icon = h.status === 'confirmed' ? '✅' : h.status === 'adjusted' ? '🔧' : h.status === 'rejected' ? '❌' : '⏳';
    return `  ${icon} [${h.id}] ${h.question}\n     → ${h.finding}`;
  }).join('\n');

  // ── 観察ログ ──
  const obsSummary = observations.length > 0
    ? observations.map((o: any) =>
        `  [${o.category}/${o.priority}] ${o.observation}${o.hypothesis ? ' → 仮説: ' + o.hypothesis : ''}`
      ).join('\n')
    : '  なし';

  // ── アクティブ決定事項 ──
  const dirSummary = activeDirectives.length > 0
    ? activeDirectives.map((d) =>
        `  【${d.priority.toUpperCase()}/${d.category}】${d.text}`
      ).join('\n')
    : '  なし（初めての会議の場合は空です）';

  return `
## ボット現状レポート（${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })} 時点）

### アカウント基本情報
- アカウント: @suguhalove0419
- 状態: **シャドウバン回復中**（インプレッション 4〜17件/投稿）
- フォロワー: 約341人
- 投稿モード: **1日2件体制**（10:30 インプ狙いツイート / 20:00 芸能人アフィリ）
- 回復閾値: 平均インプ≥30 × 7日連続 → 4件/日通知

### パフォーマンス統計
- 総投稿数: ${stats.totalPosts}件（全期間）
- 直近7日: ${stats.postsLast7Days}件
- 累計いいね: ${stats.totalLikes}
- 累計RT: ${stats.totalRetweets}
- 外部パターン収集数: ${extInfo.count}件

### インプレッション回復推移（直近14日）
${snapshotSummary}

### 直近20件の投稿（最新順）
${recentPostsSummary || '  データなし'}

### 外部パターン高スコアTOP5（参考事例）
${extSummary}

### 戦略エンジン仮説状態
- 監視間隔: ${strategy.monitorIntervalHours}h / サイクル: ${strategy.cycleStats?.totalCycles ?? 0}回
- コンテンツ重み: ${JSON.stringify(strategy.typeWeights)}
${hypothesesSummary || '  仮説なし'}

### 手動観察ログ（直近10件）
${obsSummary}

### 会議室アクティブ決定事項
${dirSummary}
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
1. 最新の情報・事例をウェブ検索して提示する
2. このボットの具体的な状況（フォロワー341人、インプ4〜17件、2件/日体制）に即したアドバイスを提供する
3. 日本語で、明確で実用的な回答をする
4. 数字や具体的な行動指針を含める
5. 現在のアクティブ決定事項も踏まえた提言をする`;

  const userMessage = `次のテーマについて詳しく調査・分析してください：\n\n${topic}`;

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

  const session: ResearchSession = { id, topic, result, model: response.model, startedAt, completedAt };

  cache.researches.unshift(session);
  cache.researches = cache.researches.slice(0, 20);
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
  cache.meetings = cache.meetings.slice(0, 10);
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

  let researchContext = '';
  if (session.researchId) {
    const research = cache.researches.find((r) => r.id === session.researchId);
    if (research) {
      researchContext = `\n\n## 関連リサーチ結果（テーマ: ${research.topic}）\n${research.result.slice(0, 3000)}`;
    }
  }

  const systemPrompt = `あなたはFANZA XアフィリエイトボットのAI戦略アドバイザーです。
ユーザーはこのボットのオーナーで、シャドウバン回復後の収益化を目指しています。

${botContext}${researchContext}

会議のルール：
- 上記の実際のデータ（インプレッション数、投稿履歴、仮説状態など）に基づいて回答する
- アクティブ決定事項（上記参照）を常に考慮し、矛盾しない提案をする
- 具体的・実用的なアドバイスを優先する（「増やす」ではなく「20:00の投稿を週3回に増やす」のように）
- 実装可能な提案をする（コードはClaudeが担当）
- 結論・行動指針を明確に示す
- 決定事項として保存すべき重要な合意事項は「📌 決定事項候補:」として明示する
- 日本語で回答する`;

  const history: OpenAI.ChatCompletionMessageParam[] = session.messages.slice(-12).map((m) => ({
    role: m.role,
    content: m.content,
  }));

  history.push({ role: 'user', content: userMessage });

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'system', content: systemPrompt }, ...history],
    temperature: 0.7,
    max_tokens: 2000,
  });

  const assistantContent = response.choices[0]?.message?.content ?? '（応答なし）';

  const userMsg: MeetingMessage = { role: 'user', content: userMessage, at: new Date().toISOString() };
  const assistantMsg: MeetingMessage = { role: 'assistant', content: assistantContent, at: new Date().toISOString() };

  session.messages.push(userMsg, assistantMsg);
  await saveData();

  return assistantMsg;
}

// ─── Directives（会議決定事項）CRUD ────────────────────────────────────────

export async function addDirective(
  text: string,
  category: MeetingDirective['category'],
  priority: MeetingDirective['priority'],
  source: string,
): Promise<MeetingDirective> {
  const now = new Date().toISOString();
  const directive: MeetingDirective = {
    id: `dir-${Date.now()}`,
    text,
    category,
    priority,
    status: 'active',
    source,
    createdAt: now,
    updatedAt: now,
  };
  cache.directives.unshift(directive);
  await saveData();
  console.log(`  📌 会議決定事項追加 [${category}/${priority}]: ${text.slice(0, 60)}...`);
  return directive;
}

export function getDirectives(): MeetingDirective[] {
  return cache.directives;
}

export function getActiveDirectives(): MeetingDirective[] {
  return cache.directives.filter((d) => d.status === 'active');
}

export async function updateDirectiveStatus(
  id: string,
  status: MeetingDirective['status'],
): Promise<MeetingDirective | null> {
  const d = cache.directives.find((x) => x.id === id);
  if (!d) return null;
  d.status = status;
  d.updatedAt = new Date().toISOString();
  await saveData();
  return d;
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
