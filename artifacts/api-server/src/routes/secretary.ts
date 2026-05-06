/**
 * secretary.ts — AIセクレタリー チャット API
 *
 * POST /api/secretary/chat
 *   body: { message: string; sessionId?: string }
 *   → { reply: string; sessionId: string }
 *
 * セッションごとに会話履歴をインメモリ保持（最大20ターン）。
 * ボットのリアルタイム状態（投稿数・会議決定・戦略）を
 * システムプロンプトに埋め込んで状況把握できる秘書を実現。
 */

import { Router } from 'express';
import OpenAI from 'openai';
import { buildBotContext } from '../bot/meeting.js';
import { getStats, getAllPosts, getRebrandlyData } from '../bot/storage.js';
import { getDirectives } from '../bot/meeting.js';

const router = Router();
let _openai: OpenAI | null = null;
function getOpenAI() { if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY ?? 'dummy' }); return _openai; }
const openai = new Proxy({} as OpenAI, { get: (_, p) => (getOpenAI() as any)[p] });

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

// セッション履歴（インメモリ / 最大50セッション）
const sessions = new Map<string, ChatMessage[]>();
const SESSION_MAX_TURNS = 20;
const SESSION_LIMIT = 50;

function getOrCreateSession(sessionId: string): ChatMessage[] {
  if (!sessions.has(sessionId)) {
    if (sessions.size >= SESSION_LIMIT) {
      // 最古のセッションを削除
      const oldestKey = sessions.keys().next().value;
      if (oldestKey) sessions.delete(oldestKey);
    }
    sessions.set(sessionId, []);
  }
  return sessions.get(sessionId)!;
}

function buildSystemPrompt(): string {
  const stats = getStats();
  const posts = getAllPosts();
  const directives = getDirectives();
  const rbData = getRebrandlyData();
  const activeDirs = directives.filter(d => d.status === 'active');
  const completedDirs = directives.filter(d => d.status === 'completed');

  // ボットコンテキスト（リアルタイム状態）
  let botCtx = '';
  try {
    botCtx = buildBotContext();
  } catch (e) {
    botCtx = '（コンテキスト取得失敗）';
  }

  return `あなたは「FANZAボット秘書」です。オーナーの gomishu0930（@gomi_shu_god）専属として、ボットの状況を把握・説明し、質問に答えてください。

## あなたの役割
- オーナーが「今ボットはどんな状態？」「先週のインプはどれくらい？」「会議で何が決まった？」などを聞いたときに、的確に答える
- 日本語で、簡潔かつ丁寧に回答する
- 技術的な質問にも、わかりやすく説明する
- 質問が曖昧な場合は「どういった点について知りたいですか？」と確認する

## 現在のボット状況（リアルタイム情報）

### 基本統計
- 総投稿数: ${stats.totalPosts ?? 0}件
- 成功投稿: ${stats.successfulPosts ?? 0}件 / 失敗: ${stats.failedPosts ?? 0}件
- 最終投稿: ${stats.lastPostedAt ? new Date(stats.lastPostedAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : 'なし'}

### 会議・決定事項
- アクティブな決定事項: ${activeDirs.length}件
- 完了済み決定事項: ${completedDirs.length}件
- 最新のアクティブ決定（上位3件）:
${activeDirs.slice(0, 3).map((d, i) => `  ${i + 1}. [${d.priority}/${d.category}] ${d.text.slice(0, 80)}`).join('\n') || '  なし'}

### Rebrandlyクリック計測
- 登録リンク数: ${rbData.links.length}件
- 合計クリック: ${rbData.links.reduce((s, l) => s + l.clicks, 0)}件
- 最終同期: ${rbData.lastSyncedAt ? new Date(rbData.lastSyncedAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : '未同期'}

### 詳細コンテキスト
${botCtx}

---
現在日時（JST）: ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}
`;
}

// POST /api/secretary/chat
router.post('/secretary/chat', async (req, res) => {
  const { message, sessionId: rawSessionId } = req.body ?? {};

  if (!message?.trim()) {
    res.status(400).json({ error: 'message は必須です' });
    return;
  }

  if (!process.env.OPENAI_API_KEY) {
    res.status(503).json({ error: 'OpenAI APIキーが未設定です' });
    return;
  }

  const sessionId = rawSessionId ?? `sess-${Date.now()}`;
  const history = getOrCreateSession(sessionId);

  // 履歴に追加
  history.push({ role: 'user', content: message.trim() });

  // 最大ターン数を超えたら古いものを削除（先頭から）
  while (history.length > SESSION_MAX_TURNS * 2) {
    history.splice(0, 2);
  }

  try {
    const systemPrompt = buildSystemPrompt();

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        ...history.map(m => ({ role: m.role, content: m.content })),
      ],
      max_tokens: 1000,
      temperature: 0.7,
    });

    const reply = completion.choices[0]?.message?.content ?? '（応答なし）';
    history.push({ role: 'assistant', content: reply });

    res.json({ reply, sessionId });
  } catch (e: any) {
    console.error('  ❌ [秘書] OpenAI エラー:', e.message);
    res.status(500).json({ error: `AI応答エラー: ${e.message}` });
  }
});

// DELETE /api/secretary/session/:id — 会話履歴リセット
router.delete('/secretary/session/:id', (req, res) => {
  sessions.delete(req.params.id);
  res.json({ ok: true });
});

export default router;
