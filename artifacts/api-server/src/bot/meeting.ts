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
  successCriteria?: string;
}

export interface MeetingSession {
  id: string;
  title: string;
  createdAt: string;
  messages: MeetingMessage[];
  researchId?: string;
  decisionCandidates?: DecisionCandidate[];
}

export interface DirectiveExecution {
  at: string;
  actionType: string;        // 'strategy.update' | 'template.generate' | 'celeb.update' | 'no-op'
  summary: string;           // 人間向け実行結果サマリー
  changes: string[];         // 具体的な変更内容リスト
  success: boolean;
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
  executionLog?: DirectiveExecution[];  // 自動実行の履歴
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
    ? activeDirectives.map((d) => `  【${d.priority}/${d.category}/${d.assignee ?? '?'}】${d.text}`).join('\n')
    : '  なし';

  // 前回会議の決定事項と進捗
  const prevMeeting = cache.meetings.find(m => m.decisionCandidates && m.decisionCandidates.length > 0 && m.id !== cache.meetings[0]?.id);
  const prevMeetingCtx = prevMeeting
    ? `\n### 前回会議決定事項（${new Date(prevMeeting.createdAt).toLocaleDateString('ja-JP')} / ${prevMeeting.title}）\n${(prevMeeting.decisionCandidates ?? []).slice(0, 5).map(c => {
        const matchingDir = cache.directives.find(d => d.text === c.text);
        const status = matchingDir ? `[${matchingDir.status}]` : '[未追跡]';
        return `  ${status} [${c.priority}/${c.assignee}] ${c.text}`;
      }).join('\n')}`
    : '';

  // 今週の A/B テスト進捗
  const now = new Date();
  const weekStr = now >= new Date('2026-04-14') ? 'W2(05:00枠)実施中' : 'W1(10:30枠)実施中';

  return `## ボット現状（${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}）

### アカウント
- @suguhalove0419 / シャドウバン回復中 / フォロワー約341人
- 投稿モード: 1日1件・${weekStr}（A/Bテスト）
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

### アクティブ決定事項（AI担当/user担当を区別）
${dirSummary}
${prevMeetingCtx}`.trim();
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

  const systemContent = `あなたはXアルゴリズムとデータ分析の鬼才（o3 Thinking）として戦略会議に参加しています。

【あなたの役割・思考スタイル】
- 感情より数字。根拠のない提案には必ず「それを裏付けるデータは？」と迫る
- Xのアルゴリズム変化・インプレッション推移・外部ベンチマークを主な論拠とする
- シャドウバン回復において「今週何をすべきか」を1〜3個の具体的行動に絞る
- Claudeが楽観的すぎたり曖昧な提案をした場合は容赦なく反論する
- 合意する場合も「なぜそれが正しいか」を数字で補強する
- 決して「様子を見ましょう」では終わらせない。必ず具体的な仮説と検証方法を示す

【禁止事項】
- 「どちらも大切」「バランスが重要」などの曖昧な結論
- データなしの感覚的主張
- Claudeへの過度な同意（3回以上連続で同意しない）

${botContext}${researchCtx}${history}
${extraInstruction}
重要な合意点・行動提案は「📌 決定候補:」と明記。日本語で回答してください。`;

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
    system: `あなたはシャドウバン回復とXグロースハック専門のストラテジスト（Claude Sonnet）として戦略会議に参加しています。

【あなたの役割・思考スタイル】
- 「何をしてはいけないか」を最優先に考える。シャドウバン悪化リスクを常に評価する
- GPTのデータ分析を「現場視点」でチェックし、机上の空論になっていないか監視する
- 実装コスト・副作用・タイミングリスクを具体的に指摘する
- 「これをやると何が壊れるか」を必ず考える。楽観論には冷水を浴びせる
- 前回会議の決定事項が守られているか・効果が出ているかを検証する
- 最終ラウンドでは必ず「今週のNo.1優先事項」を1つ断言して終わる

【禁止事項】
- GPTへの過度な賛同（「おっしゃる通り」で始まる発言を3回以上繰り返さない）
- 「さらなる情報収集が必要」などの先送り結論
- リスク指摘だけして代替案を示さないこと

${botContext}${researchCtx}${history}
${extraInstruction}
重要な合意点・行動提案は「📌 決定候補:」と明記。日本語で回答してください。`,
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
    return `【ラウンド${round}/${total} - データ立論】最初の発言です。
①現在のインプレッション推移データから読める「最大の課題」を1つ断言してください。
②外部ベンチマーク・アルゴ動向を根拠に「今週試すべき仮説」を具体的に1〜2個提案してください。
③Claudeへの挑戦的な問いかけで終わらせてください（例：「あなたはリスクと言うが、やらないリスクは？」）。
数字・根拠なしの主張は禁止。`;
  }
  if (round === 2) {
    return `【ラウンド${round}/${total} - 反証検討】Claudeの反論を真剣に検討してください。
①Claudeが正しい部分を1つ認め、なぜそれが正しいかを説明する（ただし全面撤退は禁止）。
②あなたの仮説のうち「絶対に譲れない核心」を絞り込んで再主張する。
③シャドウバン回復という文脈でClaudeの懸念に反論する具体的根拠を示す。`;
  }
  if (round === 3) {
    return `【ラウンド${round}/${total} - 深掘り】議論が深まってきました。
①これまでの議論で「まだ掘り下げていない盲点」を1つ指摘してください。
②A/Bテストという実験フレームを使って、あなたの仮説をどう検証するか具体的に示してください。
③Claudeに「週次で測定すべき指標」を1つ提案し、合意を迫ってください。`;
  }
  if (round === total) {
    return `【ラウンド${round}/${total} - 最終立場表明】
①この議論で変わった点と変わらなかった点を明確に区別してください。
②「今週月曜日にAIが実行すべき1つの具体的アクション」を断言してください（曖昧不可）。
③Claudeの最終統合への布石として、最重要の未解決論点を1つ残してください。`;
  }
  return `【ラウンド${round}/${total} - 再論・強化】Claudeの最新の指摘を受けて。
認める点は認めた上で、あなたのコアとなる主張をより強い根拠で再強化してください。
「前回会議からの進捗」の文脈で、この提案の緊急性を訴えてください。`;
}

// ラウンドごとのClaude指示
function claudeRoundInstruction(round: number, total: number): string {
  if (round === 1) {
    return `【ラウンド${round}/${total} - リスク評価・反論】GPTの立論を受けて。
①GPTの仮説の「最も危険な前提」を1つ特定し、シャドウバン悪化リスクの観点から反論してください。
②ただし全否定は禁止。代替案または修正案を必ず出してください。
③前回会議の決定事項に照らして「すでにやっていること・まだやっていないこと」を確認してください。`;
  }
  if (round === 2) {
    return `【ラウンド${round}/${total} - 現場視点】GPTが仮説を修正してきました。
①修正後の提案について「実装したら何が起きるか」を時系列で予測してください（Week1→Week2→Week3）。
②最悪シナリオを1つ明示し、それへの対処策も提案してください。
③あなたが今最も重要と考える行動を1つ、根拠とともに主張してください。`;
  }
  if (round === total) {
    return `【ラウンド${round}/${total} - 最終統合・決断】${total}ラウンドの議論を締めてください。

必須構成（この順で）：
1. 【合意事項】両者が同意した点を箇条書き（最低2点）
2. 【残る対立】まだ見解が分かれている点（あれば）
3. 【今週のNo.1優先事項】1つだけ断言（「〜すべき」形式）
4. 【📌 決定候補】AI実行可能なアクションを3〜5件、"📌 決定候補:" から始めて列挙

決して「様子を見る」「情報収集が必要」で終わらないこと。`;
  }
  return `【ラウンド${round}/${total} - 反論・補完】GPTの主張を批判的に検討してください。
同意できる点を1つ明示した上で、実装リスク・シャドウバン悪化リスク・タイミングの観点から反論してください。
「データがそう言っているからやる」ではなく「アカウントの現状に照らして本当に正しいか」を問い続けてください。`;
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

  const prompt = `以下はFANZA Xボット運営に関する戦略会議（o3 Thinking・Claude Sonnet）の議事録です。

${botContext}

## 議事録
${transcript}

---
この会議で合意・提案された「具体的な行動決定事項」を4〜8件抽出し、以下のJSON配列形式で返してください。
必ず有効なJSONのみ返し、コードブロックやコメントは含めないでください。

抽出基準（厳格に守ること）：
- 「様子を見る」「情報収集する」などの曖昧な内容は除外
- 「📌 決定候補:」として明記された提案を優先的に含める
- 誰が・いつ・何をするかが明確な事項のみ採用
- 両者が合意した事項は必ず含める（対立中の事項でも合意点があれば含める）

assignee の分類基準：
- "user"   : ユーザー本人（アカウントオーナー）が手動で行うこと
- "others" : 外部の人・サービス・パートナーが行うこと
- "ai"     : ボット（AI）が自動で実行・監視・生成すること

[
  {
    "text": "決定事項の本文（主語＋動詞＋目的語の形式で・抽象表現禁止）",
    "category": "strategy|content|timing|recovery|other のいずれか",
    "priority": "high|medium|low のいずれか",
    "rationale": "この決定の根拠（会議での論点を引用して1〜2文）",
    "assignee": "user|others|ai のいずれか",
    "successCriteria": "この決定が成功したと判断する具体的な指標（例：週平均インプ150以上）"
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
      successCriteria: item.successCriteria ? String(item.successCriteria) : undefined,
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

export async function saveDirectiveExecution(
  id: string,
  execution: DirectiveExecution,
): Promise<MeetingDirective | null> {
  const d = cache.directives.find((x) => x.id === id);
  if (!d) return null;
  if (!d.executionLog) d.executionLog = [];
  d.executionLog.unshift(execution);
  d.executionLog = d.executionLog.slice(0, 10); // 最新10件のみ保持
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
