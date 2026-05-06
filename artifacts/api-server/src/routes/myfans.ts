/**
 * routes/myfans.ts — MyFans アフィリエイト取り込み・管理 API
 *
 * POST /myfans/fetch-job          — Computer Use 向け取得ジョブ作成
 * POST /myfans/ingest             — JSON + メディアファイル取り込み
 * GET  /myfans/items              — 一覧取得
 * GET  /myfans/items/:id          — 単品取得
 * POST /myfans/items/:id/generate-caption — X向け投稿文生成
 * PATCH /myfans/items/:id/status  — ステータス更新
 * POST /myfans/approve            — 承認 → 投稿キューへ
 * DELETE /myfans/items/:id        — 削除
 */
import { Router, type IRouter, type Request, type Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';
import {
  initMyfansStore,
  getMyfansItems,
  getMyfansItem,
  addMyfansItem,
  updateMyfansItem,
  deleteMyfansItem,
  isDuplicate,
  createFetchJob,
  getFetchJobs,
  updateFetchJobStatus,
  type MyFansMedia,
  type MyFansStatus,
} from '../bot/myfans-store.js';
import { enqueuePost } from '../bot/post-queue.js';
import { filterContent } from '../bot/content-filter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MEDIA_DIR = path.join(__dirname, '../../fanza-bot/data/myfans-media');
fs.mkdirSync(MEDIA_DIR, { recursive: true });

const router: IRouter = Router();

function paramValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, MEDIA_DIR),
    filename: (_req, file, cb) => {
      const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, `${Date.now()}_${safe}`);
    },
  }),
  limits: { fileSize: 20 * 1024 * 1024, files: 10 },
  fileFilter: (_req, file, cb) => {
    const allowed = /\.(jpg|jpeg|png|gif|webp|mp4|mov)$/i;
    cb(null, allowed.test(file.originalname));
  },
});

let _anthropic: Anthropic | null = null;
function getAnthropic() { if (!_anthropic) _anthropic = new Anthropic({ baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL, apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY ?? 'dummy' }); return _anthropic; }
const anthropic = new Proxy({} as Anthropic, { get: (_, p) => (getAnthropic() as any)[p] });

// ─── 認証ミドルウェア ──────────────────────────────────────────────────────────

function requireIngestSecret(req: Request, res: Response, next: () => void): void {
  const secret = process.env.MYFANS_INGEST_SECRET;
  if (!secret) {
    next();
    return;
  }
  const auth = req.headers['authorization'] ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (token !== secret) {
    res.status(401).json({ ok: false, error: '認証エラー' });
    return;
  }
  next();
}

// ─── 初期化保証 ───────────────────────────────────────────────────────────────

async function ensureInit() {
  await initMyfansStore();
}

// ─── POST /myfans/fetch-job ───────────────────────────────────────────────────

router.post('/myfans/fetch-job', requireIngestSecret, async (req: Request, res: Response) => {
  await ensureInit();
  const target_count = Number(req.body?.target_count ?? 5);
  const job = createFetchJob(target_count);
  res.json({ ok: true, job });
});

// ─── GET /myfans/fetch-jobs ───────────────────────────────────────────────────

router.get('/myfans/fetch-jobs', async (_req: Request, res: Response) => {
  await ensureInit();
  res.json({ ok: true, jobs: getFetchJobs() });
});

// ─── POST /myfans/fetch-jobs/:id/status ──────────────────────────────────────

router.patch('/myfans/fetch-jobs/:id/status', requireIngestSecret, async (req: Request, res: Response) => {
  const { status } = req.body ?? {};
  if (!['pending', 'in_progress', 'done'].includes(status)) {
    res.status(400).json({ ok: false, error: '不正なステータス' });
    return;
  }
  updateFetchJobStatus(paramValue(req.params.id), status);
  res.json({ ok: true });
});

// ─── POST /myfans/ingest ──────────────────────────────────────────────────────

router.post(
  '/myfans/ingest',
  requireIngestSecret,
  upload.array('media_files', 10),
  async (req: Request, res: Response) => {
    await ensureInit();

    let body: any = req.body;
    if (typeof body?.data === 'string') {
      try {
        body = JSON.parse(body.data);
      } catch {
        /* keep as-is */
      }
    }

    const items: any[] = Array.isArray(body) ? body : body?.items ?? [body];
    const results: any[] = [];
    const files = (req.files as Express.Multer.File[]) ?? [];

    for (const raw of items) {
      const creator_name = String(raw.creator_name ?? '').trim();
      const source_url = String(raw.source_url ?? '').trim();
      const affiliate_url = String(raw.affiliate_url ?? '').trim();
      const original_text = String(raw.original_text ?? '').trim();

      if (!affiliate_url) {
        results.push({ source_url, skipped: true, reason: 'affiliate_url が空です' });
        continue;
      }

      if (isDuplicate(source_url, affiliate_url)) {
        results.push({ source_url, skipped: true, reason: '重複登録' });
        continue;
      }

      const ALLOWED_TYPES = new Set(['official_preview', 'thumbnail', 'user_owned']);
      const media_files: MyFansMedia[] = (raw.media_files ?? [])
        .filter((m: any) => ALLOWED_TYPES.has(m.type))
        .map((m: any) => ({
          filename: String(m.filename ?? ''),
          url: m.url ? String(m.url) : undefined,
          type: m.type as any,
          mimeType: m.mimeType,
          sizeBytes: m.sizeBytes,
        }));

      for (const f of files) {
        media_files.push({
          filename: f.filename,
          url: `/api/myfans/media/${f.filename}`,
          type: 'user_owned',
          mimeType: f.mimetype,
          sizeBytes: f.size,
        });
      }

      const item = addMyfansItem({
        provider: 'myfans',
        creator_name,
        source_url,
        affiliate_url,
        original_text,
        generated_caption: '',
        media_files,
        status: 'draft',
        safety_notes: [],
      });

      results.push({ id: item.id, source_url, created: true });
    }

    res.json({ ok: true, results });
  },
);

// ─── GET /myfans/items ────────────────────────────────────────────────────────

router.get('/myfans/items', async (req: Request, res: Response) => {
  await ensureInit();
  const status = req.query.status as MyFansStatus | undefined;
  const items = getMyfansItems(status);
  res.json({ ok: true, items, total: items.length });
});

// ─── GET /myfans/items/:id ────────────────────────────────────────────────────

router.get('/myfans/items/:id', async (req: Request, res: Response) => {
  await ensureInit();
  const item = getMyfansItem(paramValue(req.params.id));
  if (!item) {
    res.status(404).json({ ok: false, error: '見つかりません' });
    return;
  }
  res.json({ ok: true, item });
});

// ─── POST /myfans/items/:id/generate-caption ─────────────────────────────────

router.post('/myfans/items/:id/generate-caption', async (req: Request, res: Response) => {
  await ensureInit();
  const item = getMyfansItem(paramValue(req.params.id));
  if (!item) {
    res.status(404).json({ ok: false, error: '見つかりません' });
    return;
  }

  const style = String(req.body?.style ?? 'friend');

  const systemPrompt = `あなたはX（旧Twitter）の成人向けアフィリエイト投稿文ライターです。
以下のルールを必ず守ってください:
- 露骨すぎる性的表現は使わない（18禁前提でも「えっち系」の婉曲表現まで）
- 未成年を想起させる表現は絶対に使わない
- 特定個人の本名・住所・SNSアカウントへの言及はしない
- なりすまし・誹謗中傷表現は使わない
- アフィリエイトURLは必ず文末に含める
- 140文字以内（絵文字込み）
- 日本語のみ`;

  const styleMap: Record<string, string> = {
    friend: '友達に話すような自然な口調でおすすめする文体',
    promo: '少しだけ煽り気味の販促口調',
    night: '夜向けの軽い雑談風',
    review: 'レビュー風（箇条書き感想）',
  };

  const userPrompt = `以下のMyFansクリエイター情報をもとに、X投稿文を生成してください。

文体: ${styleMap[style] ?? styleMap.friend}
クリエイター名: ${item.creator_name || '（不明）'}
元の投稿文（参考）: ${item.original_text || '（なし）'}
アフィリエイトURL: ${item.affiliate_url}

投稿文のみを返してください（説明文は不要）。`;

  try {
    const res2 = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      max_tokens: 200,
    });

    const caption = (res2.content[0] as { type: string; text: string })?.text?.trim() ?? '';

    const safety = filterContent(caption);
    if (!safety.safe) {
      const notes = safety.blockedWords?.length
        ? safety.blockedWords
        : [safety.reason ?? '安全フィルター引っかかり'];
      const updated = updateMyfansItem(item.id, {
        safety_notes: notes,
        status: 'rejected',
      });
      res.json({
        ok: false,
        error: '生成文が安全フィルターに引っかかりました',
        violations: notes,
        item: updated,
      });
      return;
    }

    const updated = updateMyfansItem(item.id, {
      generated_caption: caption,
      safety_notes: [],
      status: item.status === 'draft' ? 'reviewed' : item.status,
    });

    res.json({ ok: true, caption, item: updated });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─── PATCH /myfans/items/:id/status ──────────────────────────────────────────

router.patch('/myfans/items/:id/status', async (req: Request, res: Response) => {
  await ensureInit();
  const VALID: MyFansStatus[] = ['draft', 'reviewed', 'approved', 'rejected', 'posted'];
  const status = req.body?.status as MyFansStatus;
  if (!VALID.includes(status)) {
    res.status(400).json({ ok: false, error: '不正なステータス' });
    return;
  }

  const id = paramValue(req.params.id);
  const item = getMyfansItem(id);
  if (!item) {
    res.status(404).json({ ok: false, error: '見つかりません' });
    return;
  }

  const updated = updateMyfansItem(id, { status });
  res.json({ ok: true, item: updated });
});

// ─── POST /myfans/approve ─────────────────────────────────────────────────────

router.post('/myfans/approve', async (req: Request, res: Response) => {
  await ensureInit();
  const id = String(req.body?.id ?? '');
  const item = getMyfansItem(id);

  if (!item) {
    res.status(404).json({ ok: false, error: '見つかりません' });
    return;
  }
  if (!item.affiliate_url) {
    res.status(400).json({ ok: false, error: 'affiliate_url が空です。投稿候補にできません' });
    return;
  }
  if (!item.generated_caption) {
    res.status(400).json({ ok: false, error: 'generated_caption がありません。先にキャプション生成してください' });
    return;
  }

  const safety = filterContent(item.generated_caption);
  if (!safety.safe) {
    const notes = safety.blockedWords?.length ? safety.blockedWords : [safety.reason ?? 'NG'];
    updateMyfansItem(id, { status: 'rejected', safety_notes: notes });
    res.status(400).json({ ok: false, error: '安全チェック失敗', violations: notes });
    return;
  }

  const queueItem = enqueuePost({
    type: 'myfans',
    text: item.generated_caption,
    affiliateUrl: item.affiliate_url,
    itemTitle: `MyFans: ${item.creator_name}`,
    imageUrl: item.media_files.find(m => m.url)?.url,
    provider: 'myfans',
    sourceUrl: item.source_url,
    mediaFiles: item.media_files.map(m => ({
      filename: m.filename,
      url: m.url,
      type: m.type,
    })),
  });

  // MyFansItem は approved のまま維持（queue_id でキューとリンク）
  // ステータスは approved → 投稿後にキュー側で posted になったら手動で posted に更新
  const updated = updateMyfansItem(id, {
    status: 'approved',
    queue_id: queueItem.id,
  });

  res.json({ ok: true, item: updated, queue_item: queueItem });
});

// ─── DELETE /myfans/items/:id ─────────────────────────────────────────────────

router.delete('/myfans/items/:id', async (req: Request, res: Response) => {
  await ensureInit();
  const ok = deleteMyfansItem(paramValue(req.params.id));
  res.json({ ok });
});

// ─── GET /myfans/media/:filename ─────────────────────────────────────────────

router.get('/myfans/media/:filename', (req: Request, res: Response) => {
  const safe = paramValue(req.params.filename).replace(/[^a-zA-Z0-9._-]/g, '');
  const filePath = path.join(MEDIA_DIR, safe);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: '見つかりません' });
    return;
  }
  res.sendFile(filePath);
});

export default router;
