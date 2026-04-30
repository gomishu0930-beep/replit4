import { Router } from 'express';
import {
  getSafetyStatus,
  validatePost,
  updateFollowerCount,
  updateConfig,
  setAccountCreatedAt,
  getRiskHistory,
  recordFollowEvent,
} from '../bot/safety-engine.js';

const router = Router();

router.get('/safety/status', (_req, res) => {
  res.json(getSafetyStatus());
});

router.post('/safety/validate-post', (req, res) => {
  const { isAffiliate = false } = req.body ?? {};
  res.json(validatePost(isAffiliate));
});

router.post('/safety/update-followers', (req, res) => {
  const { count } = req.body ?? {};
  if (typeof count !== 'number' || count < 0) {
    res.status(400).json({ error: 'count は0以上の数値が必要です' });
    return;
  }
  updateFollowerCount(count);
  res.json({ ok: true, ...getSafetyStatus() });
});

router.post('/safety/record-follow', (req, res) => {
  const { count = 1 } = req.body ?? {};
  const result = recordFollowEvent(count);
  res.json(result);
});

router.put('/safety/config', (req, res) => {
  const config = req.body ?? {};
  updateConfig(config);
  res.json({ ok: true, ...getSafetyStatus() });
});

router.post('/safety/set-account-date', (req, res) => {
  const { date } = req.body ?? {};
  if (!date) {
    res.status(400).json({ error: 'date は必須です' });
    return;
  }
  setAccountCreatedAt(date);
  res.json({ ok: true, ...getSafetyStatus() });
});

router.get('/safety/risk-history', (req, res) => {
  const days = parseInt(req.query.days as string) || 30;
  res.json({ history: getRiskHistory(days) });
});

export default router;
