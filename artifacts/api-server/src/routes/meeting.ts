import { Router } from 'express';
import {
  runDeepResearch,
  createMeetingSession,
  sendMeetingMessage,
  getResearches,
  getMeetings,
  getMeetingById,
  addDirective,
  getDirectives,
  updateDirectiveStatus,
  type MeetingDirective,
} from '../bot/meeting.js';

const router = Router();

// ─── Deep Research ──────────────────────────────────────────────────────────

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

router.get('/bot/meeting/researches/:id', (req, res) => {
  const research = getResearches().find((r) => r.id === req.params.id);
  if (!research) { res.status(404).json({ error: '見つかりません' }); return; }
  res.json(research);
});

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

router.get('/bot/meeting/sessions', (_req, res) => {
  res.json({ sessions: getMeetings() });
});

router.get('/bot/meeting/sessions/:id', (req, res) => {
  const session = getMeetingById(req.params.id);
  if (!session) { res.status(404).json({ error: '見つかりません' }); return; }
  res.json(session);
});

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

// ─── Directives（会議決定事項）──────────────────────────────────────────────

// 一覧取得
router.get('/bot/meeting/directives', (_req, res) => {
  res.json({ directives: getDirectives() });
});

// 新規追加
router.post('/bot/meeting/directives', async (req, res) => {
  const { text, category = 'other', priority = 'medium', source = '会議室' } = req.body ?? {};
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    res.status(400).json({ error: 'text は必須です' });
    return;
  }
  const validCategories: MeetingDirective['category'][] = ['strategy', 'content', 'timing', 'recovery', 'other'];
  const validPriorities: MeetingDirective['priority'][] = ['high', 'medium', 'low'];
  if (!validCategories.includes(category)) {
    res.status(400).json({ error: `category は ${validCategories.join('/')} のいずれか` });
    return;
  }
  if (!validPriorities.includes(priority)) {
    res.status(400).json({ error: `priority は ${validPriorities.join('/')} のいずれか` });
    return;
  }
  try {
    const directive = await addDirective(text.trim(), category, priority, source);
    res.json(directive);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ステータス更新（完了 / キャンセル / 再アクティブ）
router.patch('/bot/meeting/directives/:id', async (req, res) => {
  const { status } = req.body ?? {};
  const validStatuses: MeetingDirective['status'][] = ['active', 'completed', 'cancelled'];
  if (!validStatuses.includes(status)) {
    res.status(400).json({ error: `status は ${validStatuses.join('/')} のいずれか` });
    return;
  }
  try {
    const updated = await updateDirectiveStatus(req.params.id, status);
    if (!updated) { res.status(404).json({ error: '見つかりません' }); return; }
    res.json(updated);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
