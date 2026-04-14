/**
 * meeting.ts — AI 3者会議室
 *
 * 参加者：
 *   - o3 Thinking (GPT)    : データ分析・アルゴリズム戦略
 *   - Claude Sonnet        : リスク評価・シャドウバン回復戦略
 *   - Grok 4.1 Fast        : X リアルタイム情報・現場事実の裁定者
 *
 * フロー：
 *   Web Research → 3AI議論（5ラウンド×3者）→ 決定事項抽出 → 保存・全体反映
 */

import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { queryGrok } from './grok.js';
import { readJson, writeJson } from './cloudStore.js';
import { getAllPosts, getStats, getExternalPatternsInfo, getDailyImpressionSnapshots, getObservations, getRebrandlyData } from './storage.js';
import { getStrategySummary } from './strategy.js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

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

export type Speaker = 'user' | 'gpt' | 'claude' | 'grok' | 'system';

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
  platform: 'x' | 'threads';  // どのプラットフォーム会議で決定されたか
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

// ─── 画像生成ルールブック読み込み ────────────────────────────────────────────

let _rulebookCache: string | null = null;
let _rulebookFull: string | null = null;

function loadRulebook(): { summary: string; full: string } {
  if (_rulebookCache && _rulebookFull) return { summary: _rulebookCache, full: _rulebookFull };
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const rulebookPath = resolve(__dirname, '../../data/image-generation-rulebook.md');
    const full = readFileSync(rulebookPath, 'utf-8');
    _rulebookFull = full;
    const sections = full.split(/^## /m).slice(1, 6);
    _rulebookCache = sections.map(s => '- ' + s.split('\n')[0].trim()).join('\n');
    _rulebookCache += '\n  ※橋本環奈=100点基準。合格ライン85点以上。';
  } catch {
    _rulebookCache = '  ルールブック読み込み失敗（data/image-generation-rulebook.md）';
    _rulebookFull = _rulebookCache;
  }
  return { summary: _rulebookCache, full: _rulebookFull };
}

function getImageRulebookSummary(): string {
  return loadRulebook().summary;
}

function getImageRulebookFull(): string {
  return loadRulebook().full;
}

const PROMPT_CREATION_INSTRUCTION = `
【画像プロンプト作成ルール — 必ず遵守】
会議で画像・動画プロンプトを作成・改善する場合、以下を必ず守ること:

1. **採点基準10項目すべてで高得点（各8点以上）を狙う**プロンプトを構築する
   - 顔の丸み / 目の大きさ・輝き / 鼻の形 / 口元の可愛さ / 肌の透明感
   - 髪の質感・ツヤ / 表情の自然さ / 全体バランス / 写真のリアル感 / オーラ・雰囲気
2. **共通顔プロンプトを必ずベースに使用**（省略・改変禁止）:
   RAW photo, cute japanese idol girl, baby face, round chubby cheeks, small cute button nose, large round sparkling eyes with aegyo sal, soft rounded facial features, gentle smile, mouth corners slightly upturned, see-through bangs, straight medium-length dark brown hair, delicate collarbone highlight, warm youthful glow, subtle glossy lips, light blush, natural skin texture with visible pores, fine peach fuzz on cheeks, subsurface scattering on ear tips, tiny beauty mark near jawline, natural stray hair wisps
3. **リアリティ強化キーワード必須**: shot on Sony A7IV 85mm f/1.4, film grain, volumetric haze（動画はanamorphic lens flare追加）
4. **ネガティブプロンプト必須**: plastic skin, airbrushed skin, overly smooth skin, wax figure, mannequin, CGI, digital art, illustration, painting, overexposed, underexposed
5. **投稿タイプ別の構図・衣装・表情を正確に適用**（ルールブックのセクション5〜8参照）
6. **VS構図ではGirl A = dark brown hair / Girl B = light brown hairで差別化**
7. プロンプト提案時は以下のフォーマットで出力:

\`\`\`
【プロンプト提案】投稿タイプ: [A〜G / 動画①〜③]
━━━ ポジティブプロンプト ━━━
[完全なプロンプト全文]
━━━ ネガティブプロンプト ━━━
[完全なネガティブプロンプト全文]
━━━ 採点10項目の狙い ━━━
1. 顔の丸み: [狙い / 対応キーワード] → 目標 X/10
2. 目の大きさ・輝き: [狙い] → 目標 X/10
...（10項目すべて）
━━━ 期待スコア: XX/100 (X級) ━━━
\`\`\`
`;


// ─── ボット現状コンテキスト ───────────────────────────────────────────────────

export function buildBotContext(): string {
  const stats = getStats();
  const strategy = getStrategySummary();
  const extInfo = getExternalPatternsInfo();
  const posts = getAllPosts();
  const snapshots = getDailyImpressionSnapshots(14);
  const observations = getObservations().slice(-10);
  const activeDirectives = cache.directives.filter((d) => d.status === 'active');
  const rebrandly = getRebrandlyData();

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

  // ── Rebrandly クリック集計 ──────────────────────────────────────────────────
  let rebrandlySection = '  データなし';
  if (rebrandly.links.length > 0) {
    const totalClicks = rebrandly.links.reduce((s, l) => s + l.clicks, 0);
    const topLinks = [...rebrandly.links]
      .sort((a, b) => b.clicks - a.clicks)
      .slice(0, 5)
      .map(l => `  - ${l.clicks}クリック | ${(l.title ?? l.slashtag ?? '').slice(0, 40)} | rebrand.ly/${l.slashtag}`)
      .join('\n');
    const syncedAt = rebrandly.lastSyncedAt
      ? new Date(new Date(rebrandly.lastSyncedAt).getTime() + 9 * 3600000).toLocaleString('ja-JP')
      : '不明';
    rebrandlySection = `  合計: ${totalClicks}クリック (${rebrandly.links.length}リンク) / 最終同期: ${syncedAt}\n${topLinks}`;
  }

  // ── 時間帯別エンゲージメント（JST・全投稿集計）────────────────────────────
  let hourlySection = '  計測済み投稿なし';
  const postsWithMetrics = posts.filter(p => p.metrics);
  if (postsWithMetrics.length > 0) {
    const hourBuckets: Record<number, { count: number; sumImp: number; sumLikes: number; sumScore: number }> = {};
    for (const p of postsWithMetrics) {
      const jstHour = (new Date(p.postedAt).getUTCHours() + 9) % 24;
      if (!hourBuckets[jstHour]) hourBuckets[jstHour] = { count: 0, sumImp: 0, sumLikes: 0, sumScore: 0 };
      const m = p.metrics!;
      const score = (m.like_count || 0) + (m.retweet_count || 0) * 3 + (m.bookmark_count || 0) * 2 + (m.reply_count || 0);
      hourBuckets[jstHour].count++;
      hourBuckets[jstHour].sumImp   += m.impression_count || 0;
      hourBuckets[jstHour].sumLikes += m.like_count || 0;
      hourBuckets[jstHour].sumScore += score;
    }
    const sorted = Object.entries(hourBuckets)
      .map(([h, v]) => ({
        hour: Number(h),
        count: v.count,
        avgImp:   Math.round(v.sumImp   / v.count),
        avgLikes: Math.round(v.sumLikes / v.count * 10) / 10,
        avgScore: Math.round(v.sumScore / v.count * 10) / 10,
      }))
      .sort((a, b) => b.avgScore - a.avgScore);
    hourlySection = sorted.map(r =>
      `  ${String(r.hour).padStart(2, '0')}:00 JST | n=${r.count} | インプ${r.avgImp} | ❤${r.avgLikes} | スコア:${r.avgScore}`
    ).join('\n');
  }

  return `## ボット現状（${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}）

### アカウント
- @ero_senpai1
- 投稿モード: 1日1件・${weekStr}（A/Bテスト）
- 統計: 総投稿${stats.totalPosts}件 / 直近7日${stats.postsLast7Days}件 / いいね${stats.totalLikes}

### インプレッション推移（直近14日）
${snapshotSummary}

### 直近20件の投稿
${recentPosts || '  データなし'}

### Rebrandlyクリック（FANZAアフィリリンク実績）
${rebrandlySection}

### 時間帯別エンゲージメント（JST・スコア順）
${hourlySection}

### 外部パターン高スコアTOP5
${topExt}

### 戦略仮説
${hypotheses}

### 観察ログ
${obsSummary}

### アクティブ決定事項（AI担当/user担当を区別）
${dirSummary}
${prevMeetingCtx}

### 画像・動画生成ルール（橋本環奈スコア基準）
${getImageRulebookSummary()}

### 画像プロンプト作成時の詳細ルールブック
${getImageRulebookFull()}
${PROMPT_CREATION_INSTRUCTION}`.trim();
}

// ─── Deep Research (GPT-4o + web search) ────────────────────────────────────

export async function runDeepResearch(topic: string, pendingId?: string): Promise<ResearchSession> {
  const startedAt = new Date().toISOString();
  const id = pendingId ?? `research-${Date.now()}`;
  const botContext = buildBotContext();

  // ペンディングセッションをキャッシュに即時登録（ポーリング用）
  const pending: ResearchSession = { id, topic, result: '', model: 'gpt-4o-search-preview', startedAt, completedAt: '' };
  if (!pendingId) {
    // 新規作成の場合のみunshift（pendingIdが指定された場合はルートで登録済み）
    cache.researches.unshift(pending);
  }

  let result = '';
  let modelName = 'gpt-4o-search-preview';
  try {
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
    result = response.choices[0]?.message?.content ?? '（応答なし）';
    modelName = response.model;
  } catch (e: any) {
    result = `❌ リサーチエラー: ${e.message}`;
  }

  const completedAt = new Date().toISOString();
  // キャッシュ内の該当セッションを更新（ポーリング側が取得できるよう）
  const idx = cache.researches.findIndex((r) => r.id === id);
  const session: ResearchSession = { id, topic, result, model: modelName, startedAt, completedAt };
  if (idx >= 0) {
    cache.researches[idx] = session;
  } else {
    cache.researches.unshift(session);
  }
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
    const label = m.speaker === 'gpt' ? 'o3 Thinking(GPT)' : m.speaker === 'claude' ? 'Claude Sonnet' : m.speaker === 'grok' ? 'Grok(X情報官)' : m.speaker === 'user' ? 'ユーザー' : 'システム';
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

【画像プロンプト作成時の追加役割】
- 画像・動画プロンプトの議題が出た場合、橋本環奈スコア採点基準（10項目×10点=100点）を分析し、各項目で8点以上を取れるプロンプト構成を論理的に設計する
- 過去のスコア結果データがあれば、どの項目が弱いかを数値で特定し、対応するキーワード追加・削除を具体的に提案する
- プロンプト提案時は必ず「ボットコンテキストの画像プロンプト作成ルール」のフォーマットに従う

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

// Claude Sonnet に発言させる（429クォータ超過時はフォールバックメッセージで続行）
async function speakAsClaude(session: MeetingSession, prompt: string, extraInstruction = ''): Promise<string> {
  const botContext = buildBotContext();
  const researchCtx = getResearchContext(session);
  const history = session.messages.length > 0 ? `\n\n## これまでの議論\n${buildHistory(session.messages)}` : '';

  let response;
  try {
    response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 2000,
      system: `あなたはシャドウバン回復とXグロースハック専門のストラテジスト（Claude Sonnet）として戦略会議に参加しています。

【あなたの役割・思考スタイル】
- 「何をしてはいけないか」を最優先に考える。シャドウバン悪化リスクを常に評価する
- GPTのデータ分析を「現場視点」でチェックし、机上の空論になっていないか監視する
- 実装コスト・副作用・タイミングリスクを具体的に指摘する
- 「これをやると何が壊れるか」を必ず考える。楽観論には冷水を浴びせる
- 前回会議の決定事項が守られているか・効果が出ているかを検証する
- 最終ラウンドでは必ず「今週のNo.1優先事項」を1つ断言して終わる

【画像プロンプト作成時の追加役割】
- プロンプト提案に対して「このプロンプトでX上のリスク（NSFW判定・通報リスク・シャドウバン誘発）は無いか」を必ず検証する
- 衣装・表情・構図がXのセンシティブコンテンツポリシーに抵触しないかチェックする
- 採点基準10項目のうち「写真のリアル感」と「オーラ・雰囲気」の観点から、AI生成画像だとバレにくいプロンプト技法を提案する
- プロンプト提案時は必ず「ボットコンテキストの画像プロンプト作成ルール」のフォーマットに従う

【禁止事項】
- GPTへの過度な賛同（「おっしゃる通り」で始まる発言を3回以上繰り返さない）
- 「さらなる情報収集が必要」などの先送り結論
- リスク指摘だけして代替案を示さないこと

${botContext}${researchCtx}${history}
${extraInstruction}
重要な合意点・行動提案は「📌 決定候補:」と明記。日本語で回答してください。`,
      messages: [{ role: 'user', content: prompt }],
    });
  } catch (e: any) {
    // 429クォータ超過は全体を止めず、Claudeをスキップして続行
    const errStr = String(e?.message ?? e);
    if (errStr.includes('429') || errStr.includes('RESOURCE_EXHAUSTED') || errStr.includes('quota')) {
      console.warn('  ⚠️  Claude 429 クォータ制限 — このラウンドはスキップ');
      return '（Claude：APIクォータ制限のため一時的に応答不可。o3とGrokの議論を参照してください。）';
    }
    throw e; // 429以外は通常通りスロー
  }

  const block = response.content[0];
  return block.type === 'text' ? block.text : '（応答なし）';
}

// Grok 4.1 Fast に発言させる（X リアルタイム情報官）
async function speakAsGrok(session: MeetingSession, prompt: string, extraInstruction = ''): Promise<string> {
  const botContext = buildBotContext();
  const researchCtx = getResearchContext(session);
  const history = session.messages.length > 0 ? `\n\n## これまでの議論\n${buildHistory(session.messages)}` : '';

  const systemPrompt = `あなたはXプラットフォームのリアルタイム情報官（Grok 4.1 Fast）として戦略会議に参加しています。
あなただけがXの現在進行中のデータに直接アクセスできる。この唯一の優位性を最大限に活かしてください。

【あなたの役割・思考スタイル】
- GPTとClaudeの議論を「Xの現実」でファクトチェックする
- 「今Xで実際に何が起きているか」を具体的なトレンド・事例・ユーザー行動で示す
- シャドウバン回復に成功した日本語アカウントの実例をXから引用する
- GPTの理論的分析が現場と乖離していれば指摘、Claudeのリスク懸念が過大/過小なら修正する
- 「Xがこのアルゴリズムを適用しているという根拠はXで確認できる/できない」と明言する
- 最終ラウンドでは「Xの現実に最も整合する戦略」を裁定として示す

【画像プロンプト作成時の追加役割】
- Xで実際にバズっているAI美女アカウントの画像傾向（構図・雰囲気・エンゲージメント率）をリアルタイムで調査し、プロンプトに反映すべきトレンドを報告する
- 提案されたプロンプトが「X上でエンゲージメントを取れる画像」になるかを現場データで判断する
- AI美女画像でセンシティブ判定を受けたアカウントの事例があれば共有し、回避策を提示する

【禁止事項】
- 憶測での発言（「おそらく〜」は使わない。確認できない場合は「Xでは確認できなかった」と明言）
- GPTとClaudeの二番煎じ（彼らが言わなかったX特有の情報のみ追加する）
- 1000文字を超える長文（簡潔に、インパクトのある事実のみ）

${botContext}${researchCtx}${history}
${extraInstruction}
重要な発見・裁定は「🦅 X情報:」と明記してください。日本語で回答してください。`;

  try {
    const reply = await queryGrok(prompt, systemPrompt);
    return reply || '（Grok応答なし）';
  } catch (e: any) {
    return `（Grok応答エラー: ${e.message}）`;
  }
}

// Grokスコア解析（📊 採点 R1: [o3: 7/10] [Claude: 8/10]）
function parseGrokScores(reply: string): { gpt: number; claude: number } | null {
  const m = reply.match(/\[o3[^\]]*?:\s*(\d+(?:\.\d+)?)\s*\/10\][\s\S]*?\[Claude[^\]]*?:\s*(\d+(?:\.\d+)?)\s*\/10\]/i);
  if (!m) return null;
  return { gpt: parseFloat(m[1]), claude: parseFloat(m[2]) };
}

// Grok最終裁定の自律実行指令を抽出（🎯 自律実行指令: ...）
function extractGrokDirective(reply: string): string | null {
  const m = reply.match(/🎯\s*自律実行指令[：:]\s*(.+?)(?:\n|$)/);
  return m ? m[1].trim() : null;
}

// ラウンドごとのGrok指示
function grokRoundInstruction(round: number, total: number): string {
  const scoreFormat = `\n\n発言の最後に必ず以下の採点を記載してください（必須）：\n📊 採点 R${round}: [o3: X/10] [Claude: Y/10] 理由：（1行）`;

  if (round === 1) {
    return `【ラウンド${round}/${total} - X現場報告＋採点】GPTとClaudeの議論を聞いた上で。
①GPTが提示した仮説について「Xで実際に確認できるか」をリアルタイム検索で判定してください。
②シャドウバン回復に成功した日本語アカウントの直近事例をXから1〜2件紹介してください。
③現在のXアルゴリズムで最も効いている手法を1つ、具体的証拠と共に提示してください。${scoreFormat}`;
  }
  if (round === total) {
    return `【ラウンド${round}/${total} - 最終採点＆自律裁定】${total}ラウンドの議論を経て、Xの現実に照らした最終裁定を下してください。

①各ラウンドの採点を合計し、総合スコアで勝者を決定してください。
②Xアルゴリズムの現実に最も合致する案の「今週実行すべき具体アクション」を1つ断言してください。

必須フォーマット（以下をそのまま使用）：
📊 最終総合スコア: [o3合計: X/${total * 10}] [Claude合計: Y/${total * 10}]
🏆 最終裁定: [o3|Claude]案採用 — （勝者を選んだ理由を1行）
🎯 自律実行指令: （cronが自動実行する具体的な1文。例:「FANZA新作AV投稿を毎朝10:30に1件投稿し、Rebrandlyで短縮URLを生成して本文末尾に追記する」）
🦅 X情報: （根拠となるXのリアルタイムデータを2〜3点）`;
  }
  return `【ラウンド${round}/${total} - Xファクトチェック＋採点】
GPTとClaudeの最新の主張を「Xで確認できる事実」でジャッジしてください。
どちらかの主張が事実と異なれば訂正、両者が見落としているX特有のデータがあれば追加してください。
発言は500文字以内に収めてください。${scoreFormat}`;
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

// 外部から任意の発言者のメッセージをセッションに追加（3者投稿会議用）
export async function pushMessageToSession(sessionId: string, speaker: Speaker, content: string): Promise<MeetingMessage | null> {
  const session = cache.meetings.find((m) => m.id === sessionId);
  if (!session) return null;
  const msg = pushMsg(session, speaker, content);
  await saveData();
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

export const TOTAL_ROUNDS = 5;

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

/**
 * 1ラウンドのみ実行する（タイムアウト回避のため1リクエスト＝1ラウンド）
 * フロントエンドが round=1〜5 を順番に呼び出す方式。
 */
export async function runTrialogueRound(
  sessionId: string,
  userMessage: string,
  round: number,
  lastGptReply: string = '',
  lastClaudeReply: string = '',
  lastGrokReply: string = '',
  cumulativeScores: { gpt: number; claude: number } = { gpt: 0, claude: 0 },
): Promise<{
  messages: MeetingMessage[];
  round: number;
  totalRounds: number;
  isLastRound: boolean;
  roundScores: { gpt: number; claude: number } | null;
  cumulativeScores: { gpt: number; claude: number };
  grokDirective?: MeetingDirective;
}> {
  const session = cache.meetings.find((m) => m.id === sessionId);
  if (!session) throw new Error(`会議が見つかりません: ${sessionId}`);

  // ラウンド1のみユーザーメッセージをセッションに追加
  if (round === 1) {
    pushMsg(session, 'user', userMessage);
  }

  console.log(`  🔄 [会議] ラウンド ${round}/${TOTAL_ROUNDS} 開始 (累積 o3:${cumulativeScores.gpt} Claude:${cumulativeScores.claude})`);
  const newMessages: MeetingMessage[] = [];

  // ── GPT 発言 ──
  const gptPrompt = round === 1
    ? `【議題】${userMessage}\n\nデータ分析の観点から最初の立場を示してください。`
    : `【前ラウンドのまとめ】\nClaude: ${lastClaudeReply.slice(0, 400)}\nGrok(X情報官・採点者): ${lastGrokReply.slice(0, 300)}\n\n---\n元の議題：${userMessage}\n\nClaudeの反論とGrokのX実態報告・採点を受けて立場を再検討し、返答してください。`;

  const gptReply = await speakAsGPT(session, gptPrompt, gptRoundInstruction(round, TOTAL_ROUNDS));
  const gptMsg = pushMsg(session, 'gpt', gptReply);
  newMessages.push(gptMsg);
  console.log(`    ✅ GPT完了 (${gptReply.length}文字)`);

  // ── Claude 発言 ──
  const claudePrompt = round === TOTAL_ROUNDS
    ? `${TOTAL_ROUNDS}ラウンドの議論全体（GPT・Grokの発言・採点含む）を踏まえて最終統合見解を示してください。\n\nGPT最終発言: ${gptReply.slice(0, 500)}\n前ラウンドGrok採点: ${lastGrokReply.slice(0, 300)}\n\n元の議題：${userMessage}`
    : `GPTが以下のように述べました（ラウンド${round}）：\n\n${gptReply}\n\n---\n元の議題：${userMessage}\n\nGPTの主張を批判的に検討し、返答してください。`;

  const claudeReply = await speakAsClaude(session, claudePrompt, claudeRoundInstruction(round, TOTAL_ROUNDS));
  const claudeMsg = pushMsg(session, 'claude', claudeReply);
  newMessages.push(claudeMsg);
  console.log(`    ✅ Claude完了 (${claudeReply.length}文字)`);

  // ── Grok 発言（採点者＆最終裁定者）──
  const cumulStr = `累積スコア（R1〜R${round - 1}）: o3合計=${cumulativeScores.gpt}点 / Claude合計=${cumulativeScores.claude}点\n\n`;
  const grokPrompt = round === TOTAL_ROUNDS
    ? `${cumulStr}GPT最終発言: ${gptReply.slice(0, 400)}\nClaude最終統合: ${claudeReply.slice(0, 400)}\n\n---\n元の議題：${userMessage}\n\n${TOTAL_ROUNDS}ラウンド全体の採点合計を出し、最終裁定と自律実行指令を必須フォーマットで出力してください。`
    : `GPT（ラウンド${round}）: ${gptReply.slice(0, 400)}\nClaude（ラウンド${round}）: ${claudeReply.slice(0, 400)}\n\n---\n元の議題：${userMessage}\n\nXのリアルタイムデータでこの議論をファクトチェックし、採点してください。`;

  const grokReply = await speakAsGrok(session, grokPrompt, grokRoundInstruction(round, TOTAL_ROUNDS));
  const grokMsg = pushMsg(session, 'grok', grokReply);
  newMessages.push(grokMsg);
  console.log(`    ✅ Grok完了 (${grokReply.length}文字)`);

  // ── スコア解析 ──
  const roundScores = parseGrokScores(grokReply);
  const newCumulative = roundScores
    ? { gpt: cumulativeScores.gpt + roundScores.gpt, claude: cumulativeScores.claude + roundScores.claude }
    : cumulativeScores;
  if (roundScores) {
    console.log(`    📊 採点 R${round}: o3=${roundScores.gpt} Claude=${roundScores.claude} (累積 o3=${newCumulative.gpt} Claude=${newCumulative.claude})`);
  }

  // ── 最終ラウンド: Grok裁定を自動保存 ──
  let grokDirective: MeetingDirective | undefined;
  if (round >= TOTAL_ROUNDS) {
    const directiveText = extractGrokDirective(grokReply);
    if (directiveText) {
      const winner = newCumulative.gpt >= newCumulative.claude ? 'o3' : 'Claude';
      const finalText = `[Grok裁定・${winner}案採用] ${directiveText}`;
      grokDirective = await addDirective(
        finalText,
        'content',
        'high',
        `AI会議 自律裁定 (${session.title})`,
        'ai',
        'x',
      );
      console.log(`    🏆 Grok裁定ディレクティブ自動保存: ${finalText.slice(0, 80)}`);
    }
  }

  await saveData();
  return {
    messages: newMessages,
    round,
    totalRounds: TOTAL_ROUNDS,
    isLastRound: round >= TOTAL_ROUNDS,
    roundScores,
    cumulativeScores: newCumulative,
    grokDirective,
  };
}

/** 後方互換用：全5ラウンドを順に実行（自律会議cronからのみ使用） */
export async function runTrialogue(
  sessionId: string,
  userMessage: string,
  maxRounds: number = TOTAL_ROUNDS,
): Promise<{ messages: MeetingMessage[]; grokDirective?: MeetingDirective }> {
  const allMessages: MeetingMessage[] = [];
  let lastGptReply = '', lastClaudeReply = '', lastGrokReply = '';
  let cumul = { gpt: 0, claude: 0 };
  let finalGrokDirective: MeetingDirective | undefined;

  for (let round = 1; round <= maxRounds; round++) {
    const result = await runTrialogueRound(sessionId, userMessage, round, lastGptReply, lastClaudeReply, lastGrokReply, cumul);
    allMessages.push(...result.messages);
    cumul = result.cumulativeScores;
    if (result.grokDirective) finalGrokDirective = result.grokDirective;
    const grok = result.messages.find(m => m.speaker === 'grok');
    const claude = result.messages.find(m => m.speaker === 'claude');
    const gpt = result.messages.find(m => m.speaker === 'gpt');
    if (gpt) lastGptReply = gpt.content;
    if (claude) lastClaudeReply = claude.content;
    if (grok) lastGrokReply = grok.content;
  }

  console.log(`  📊 [会議完了] 最終スコア o3:${cumul.gpt} / Claude:${cumul.claude}`);
  return { messages: allMessages, grokDirective: finalGrokDirective };
}

// ─── 決定事項自動抽出 ────────────────────────────────────────────────────────

export async function extractDecisions(sessionId: string): Promise<DecisionCandidate[]> {
  const session = cache.meetings.find((m) => m.id === sessionId);
  if (!session) throw new Error(`会議が見つかりません: ${sessionId}`);
  if (session.messages.length < 2) return [];

  const transcript = buildHistory(session.messages);
  const botContext = buildBotContext();

  const prompt = `以下はFANZA Xボット運営に関する3者戦略会議（o3 Thinking・Claude Sonnet・Grok X情報官）の議事録です。

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
      model: 'claude-sonnet-4-5',
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
  platform: 'x' | 'threads' = 'x',
): Promise<MeetingDirective> {
  const now = new Date().toISOString();
  const directive: MeetingDirective = {
    id: `dir-${Date.now()}`,
    text, category, priority,
    status: 'active',
    assignee,
    source,
    platform,
    createdAt: now,
    updatedAt: now,
  };
  cache.directives.unshift(directive);
  await saveData();
  console.log(`  📌 決定事項保存 [${platform}/${category}/${priority}]: ${text.slice(0, 60)}`);
  return directive;
}

export function getDirectives(): MeetingDirective[] {
  // platformフィールドがない旧データは 'x' として扱う（マイグレーション）
  return cache.directives.map(d => ({ ...d, platform: d.platform ?? 'x' }));
}

export function getActiveDirectives(): MeetingDirective[] {
  return getDirectives().filter((d) => d.status === 'active');
}

/** X専用の自動実行対象 — Threadsの決定事項を誤ってXボットに適用させない */
export function getXActiveDirectives(): MeetingDirective[] {
  return getDirectives().filter((d) => d.status === 'active' && (d.platform ?? 'x') === 'x');
}

/** Threads専用の決定事項 */
export function getThreadsActiveDirectives(): MeetingDirective[] {
  return getDirectives().filter((d) => d.status === 'active' && d.platform === 'threads');
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
): Promise<{ gptMsg: MeetingMessage; claudeMsg: MeetingMessage; grokMsg: MeetingMessage }> {
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

  // Grok がXリアルタイムデータの観点でユーザーの質問に回答
  const grokReply = await speakAsGrok(
    session,
    `ユーザーの質問：\n${userMessage}\n\no3の回答：\n${gptReply.slice(0, 400)}\nClaudeの回答：\n${claudeReply.slice(0, 400)}\n\n---\nX上のリアルタイムデータを根拠にしながら、ユーザーの質問に回答してください。`,
    `【Q&Aラウンド - Grok】X上の現状データで他2者の回答を検証・補強してください。「現時点のXでは〜」という形式で実態を示し、実行すべき優先順位を1つ断言して終わること。`,
  );
  const grokMsg = pushMsg(session, 'grok', grokReply);

  await saveData();
  return { gptMsg, claudeMsg, grokMsg };
}

// ─── データ取得 ────────────────────────────────────────────────────────────

export function getResearches(): ResearchSession[] { return cache.researches; }
export function getMeetings(): MeetingSession[] { return cache.meetings; }
export function getMeetingById(id: string): MeetingSession | undefined {
  return cache.meetings.find((m) => m.id === id);
}
