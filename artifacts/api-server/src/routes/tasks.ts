import { Router } from 'express';
import {
  getTaskList,
  toggleTask,
  TASK_TEMPLATES,
  jstDateKey,
  jstWeekKey,
} from '../bot/tasks.js';
import { getDirectives } from '../bot/meeting.js';

const router = Router();

// GET /bot/tasks — デイリー+ウィークリータスク一覧
router.get('/bot/tasks', (_req, res) => {
  const directives = getDirectives().filter((d) => d.status === 'active');
  const taskList = getTaskList(directives);
  res.json(taskList);
});

// PATCH /bot/tasks/:completionKey — ユーザーが手動チェック/アンチェック
router.patch('/bot/tasks/:completionKey', async (req, res) => {
  const { done } = req.body ?? {};
  const { completionKey } = req.params;
  if (typeof done !== 'boolean') {
    res.status(400).json({ error: '`done` は boolean が必要です' });
    return;
  }
  // 手動チェックは user assignee のタスクのみ許可
  const templateId = completionKey.split('_').slice(0, -1).join('_');
  const template = TASK_TEMPLATES.find((t) => t.id === templateId);
  if (template && template.assignee === 'ai') {
    res.status(403).json({ error: 'AIが自動実行するタスクは手動変更できません' });
    return;
  }
  try {
    await toggleTask(completionKey, done);
    res.json({ ok: true, done, completionKey });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
