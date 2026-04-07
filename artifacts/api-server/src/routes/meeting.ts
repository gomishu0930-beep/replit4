import { Router } from 'express';
import {
  runDeepResearch,
  createMeetingSession,
  sendToGPT,
  sendToClaude,
  runTrialogue,
  runQARound,
  extractDecisions,
  getResearches,
  getMeetings,
  getMeetingById,
  addDirective,
  getDirectives,
  updateDirectiveStatus,
  saveDirectiveExecution,
  type MeetingDirective,
  type Assignee,
} from '../bot/meeting.js';
import { executeDirective } from '../bot/directive-executor.js';

const router = Router();

// ─── Deep Research ──────────────────────────────────────────────────────────

router.get('/bot/meeting/researches', (_req, res) => {
  res.json({ researches: getResearches().map((r) => ({
    id: r.id, topic: r.topic,
    resultPreview: r.result.slice(0, 200) + '...',
    model: r.model, startedAt: r.startedAt, completedAt: r.completedAt,
  })) });
});

router.get('/bot/meeting/researches/:id', (req, res) => {
  const r = getResearches().find((x) => x.id === req.params.id);
  if (!r) { res.status(404).json({ error: '見つかりません' }); return; }
  res.json(r);
});

router.post('/bot/meeting/research', async (req, res) => {
  const { topic } = req.body ?? {};
  if (!topic?.trim()) { res.status(400).json({ error: 'topic は必須です' }); return; }
  try {
    res.json(await runDeepResearch(topic.trim()));
  } catch (e: any) {
    console.error('  ❌ Deep Research エラー:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── Meeting Sessions ────────────────────────────────────────────────────────

router.get('/bot/meeting/sessions', (_req, res) => {
  res.json({ sessions: getMeetings() });
});

router.get('/bot/meeting/sessions/:id', (req, res) => {
  const s = getMeetingById(req.params.id);
  if (!s) { res.status(404).json({ error: '見つかりません' }); return; }
  res.json(s);
});

router.post('/bot/meeting/sessions', async (req, res) => {
  const { title, researchId } = req.body ?? {};
  if (!title?.trim()) { res.status(400).json({ error: 'title は必須です' }); return; }
  try {
    res.json(await createMeetingSession(title.trim(), researchId));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Chat: 個別送信 ──────────────────────────────────────────────────────────

// GPTに送る
router.post('/bot/meeting/sessions/:id/chat/gpt', async (req, res) => {
  const { message } = req.body ?? {};
  if (!message?.trim()) { res.status(400).json({ error: 'message は必須です' }); return; }
  try {
    res.json(await sendToGPT(req.params.id, message.trim()));
  } catch (e: any) {
    console.error('  ❌ GPTチャットエラー:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Claudeに送る
router.post('/bot/meeting/sessions/:id/chat/claude', async (req, res) => {
  const { message } = req.body ?? {};
  if (!message?.trim()) { res.status(400).json({ error: 'message は必須です' }); return; }
  try {
    res.json(await sendToClaude(req.params.id, message.trim()));
  } catch (e: any) {
    console.error('  ❌ Claudeチャットエラー:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// 3者会議モード（2ラウンドディベート: GPT→Claude→GPT→Claude）
router.post('/bot/meeting/sessions/:id/trialogue', async (req, res) => {
  const { message } = req.body ?? {};
  if (!message?.trim()) { res.status(400).json({ error: 'message は必須です' }); return; }
  try {
    const result = await runTrialogue(req.params.id, message.trim());
    res.json(result);
  } catch (e: any) {
    console.error('  ❌ 3者会議エラー:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// 旧互換: /chat → GPTに送る
router.post('/bot/meeting/sessions/:id/chat', async (req, res) => {
  const { message } = req.body ?? {};
  if (!message?.trim()) { res.status(400).json({ error: 'message は必須です' }); return; }
  try {
    res.json(await sendToGPT(req.params.id, message.trim()));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Q&Aラウンド（5ラウンドディベート後のユーザー質問）
router.post('/bot/meeting/sessions/:id/qa', async (req, res) => {
  const { message } = req.body ?? {};
  if (!message?.trim()) { res.status(400).json({ error: 'message は必須です' }); return; }
  try {
    res.json(await runQARound(req.params.id, message.trim()));
  } catch (e: any) {
    console.error('  ❌ Q&Aエラー:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── 決定事項自動抽出 ────────────────────────────────────────────────────────

router.post('/bot/meeting/sessions/:id/extract-decisions', async (req, res) => {
  try {
    const candidates = await extractDecisions(req.params.id);
    res.json({ candidates });
  } catch (e: any) {
    console.error('  ❌ 決定事項抽出エラー:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── Directives ──────────────────────────────────────────────────────────────

router.get('/bot/meeting/directives', (_req, res) => {
  res.json({ directives: getDirectives() });
});

router.post('/bot/meeting/directives', async (req, res) => {
  const { text, category = 'other', priority = 'medium', source = '会議室', assignee = 'user', platform = 'x' } = req.body ?? {};
  if (!text?.trim()) { res.status(400).json({ error: 'text は必須です' }); return; }
  const validCats: MeetingDirective['category'][] = ['strategy', 'content', 'timing', 'recovery', 'other'];
  const validPris: MeetingDirective['priority'][] = ['high', 'medium', 'low'];
  const validAssignees: Assignee[] = ['user', 'others', 'ai'];
  const validPlatforms: Array<'x' | 'threads'> = ['x', 'threads'];
  if (!validCats.includes(category) || !validPris.includes(priority) || !validAssignees.includes(assignee) || !validPlatforms.includes(platform)) {
    res.status(400).json({ error: '無効な category、priority、assignee または platform' }); return;
  }
  try {
    res.json(await addDirective(text.trim(), category, priority, source, assignee, platform));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.patch('/bot/meeting/directives/:id', async (req, res) => {
  const { status } = req.body ?? {};
  const valid: MeetingDirective['status'][] = ['active', 'completed', 'cancelled'];
  if (!valid.includes(status)) { res.status(400).json({ error: '無効な status' }); return; }
  try {
    const updated = await updateDirectiveStatus(req.params.id, status);
    if (!updated) { res.status(404).json({ error: '見つかりません' }); return; }
    res.json(updated);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── 自動実行 ────────────────────────────────────────────────────────────────

router.post('/bot/meeting/directives/:id/execute', async (req, res) => {
  const directives = getDirectives();
  const directive = directives.find((d) => d.id === req.params.id);
  if (!directive) { res.status(404).json({ error: '見つかりません' }); return; }
  // 全権委任モード: 担当者問わず全ディレクティブ自動実行可能

  try {
    const execution = await executeDirective(directive);
    const updated = await saveDirectiveExecution(directive.id, execution);
    res.json({ directive: updated, execution });
  } catch (e: any) {
    console.error('[execute directive] エラー:', e);
    res.status(500).json({ error: e.message });
  }
});

export default router;
