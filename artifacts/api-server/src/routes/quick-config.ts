/**
 * quick-config.ts — クイック設定（テキスト入力 → Claude即時実行）
 *
 * ユーザーが自然言語で設定変更を入力すると、
 * Claude が解析して実行し、結果を即時返す。
 * 会議室を経由しない軽量な設定変更ルート。
 */

import { Router } from 'express';
import { executeDirective } from '../bot/directive-executor.js';
import type { MeetingDirective } from '../bot/meeting.js';

const router = Router();

// POST /api/bot/quick-config
// body: { instruction: string }
router.post('/bot/quick-config', async (req, res) => {
  const { instruction } = req.body ?? {};
  if (!instruction?.trim()) {
    res.status(400).json({ error: 'instruction は必須です' });
    return;
  }

  // ダミーディレクティブとして実行エンジンに渡す
  const dummyDirective: MeetingDirective = {
    id: `qc-${Date.now()}`,
    text: instruction.trim(),
    category: 'other',
    priority: 'medium',
    status: 'active',
    assignee: 'ai',
    source: 'クイック設定',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  try {
    console.log(`  ⚡ [クイック設定] "${instruction.slice(0, 60)}" を実行中...`);
    const execution = await executeDirective(dummyDirective);
    console.log(`  ${execution.success ? '✅' : '⚠'} [クイック設定] ${execution.summary}`);
    res.json({ execution });
  } catch (e: any) {
    console.error('[quick-config] エラー:', e.message);
    res.status(500).json({ error: e.message });
  }
});

export default router;
