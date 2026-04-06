import { Router } from 'express';
import {
  runDeepResearch,
  createMeetingSession,
  sendMeetingMessage,
  getResearches,
  getMeetings,
  getMeetingById,
} from '../bot/meeting.js';

const router = Router();

// ─── Deep Research ──────────────────────────────────────────────────────────

// リサーチ履歴一覧
router.get('/bot/meeting/researches', (_req, res) => {
  const researches = getResearches().map((r) => ({
    id: r.id,
    topic: r.topic,
    resultPreview: r.result.slice(0, 200) + '...',
    model: r.model,
    startedAt: r.startedAt,
    completedAt: r.completedAt,
  }));
  res.json({ researches });
});

// リサーチ詳細
router.get('/bot/meeting/researches/:id', (req, res) => {
  const research = getResearches().find((r) => r.id === req.params.id);
  if (!research) { res.status(404).json({ error: '見つかりません' }); return; }
  res.json(research);
});

// Deep Research 実行
router.post('/bot/meeting/research', async (req, res) => {
  const { topic } = req.body ?? {};
  if (!topic || typeof topic !== 'string' || topic.trim().length === 0) {
    res.status(400).json({ error: 'topic は必須です' });
    return;
  }
  try {
    const session = await runDeepResearch(topic.trim());
    res.json(session);
  } catch (e: any) {
    console.error('  ❌ Deep Research エラー:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── Meeting Chat ────────────────────────────────────────────────────────────

// 会議一覧
router.get('/bot/meeting/sessions', (_req, res) => {
  res.json({ sessions: getMeetings() });
});

// 会議詳細
router.get('/bot/meeting/sessions/:id', (req, res) => {
  const session = getMeetingById(req.params.id);
  if (!session) { res.status(404).json({ error: '見つかりません' }); return; }
  res.json(session);
});

// 会議セッション作成
router.post('/bot/meeting/sessions', async (req, res) => {
  const { title, researchId } = req.body ?? {};
  if (!title || typeof title !== 'string') {
    res.status(400).json({ error: 'title は必須です' });
    return;
  }
  try {
    const session = await createMeetingSession(title.trim(), researchId);
    res.json(session);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// メッセージ送信
router.post('/bot/meeting/sessions/:id/chat', async (req, res) => {
  const { message } = req.body ?? {};
  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    res.status(400).json({ error: 'message は必須です' });
    return;
  }
  try {
    const reply = await sendMeetingMessage(req.params.id, message.trim());
    res.json(reply);
  } catch (e: any) {
    console.error('  ❌ 会議チャットエラー:', e.message);
    res.status(500).json({ error: e.message });
  }
});

export default router;
