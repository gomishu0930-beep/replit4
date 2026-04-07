/**
 * Twitter OAuth 1.0a 認証フロー
 *
 * 使い方:
 *   1. ブラウザで GET /api/auth/twitter/start にアクセス
 *   2. Twitter の認証ページで「許可」
 *   3. リダイレクト先にアクセストークンが表示される
 */
import { Router } from 'express';
import { TwitterApi } from 'twitter-api-v2';

const router = Router();

const CALLBACK_URL = 'https://asset-manager-3-gomishu0930.replit.app/api/auth/twitter/callback';

// oauth_token_secret を一時保存するメモリストア（単一プロセス前提）
const pendingTokens = new Map<string, string>();

// ─── Step 1: 認証開始 ─────────────────────────────────────────────────────────
router.get('/auth/twitter/start', async (_req, res) => {
  try {
    const appClient = new TwitterApi({
      appKey: process.env.TWITTER_API_KEY ?? '',
      appSecret: process.env.TWITTER_API_SECRET ?? '',
    });

    const { url, oauth_token, oauth_token_secret } = await appClient.generateAuthLink(CALLBACK_URL, {
      linkMode: 'authorize',
    });

    // oauth_token_secret を一時保存
    pendingTokens.set(oauth_token, oauth_token_secret);

    // Twitter の認証ページにリダイレクト
    res.redirect(url);
  } catch (e: any) {
    res.status(500).send(`
      <h2>❌ 認証リンク生成に失敗しました</h2>
      <pre>${e.message}</pre>
      <p>API Key / API Secret が正しいか確認してください。</p>
    `);
  }
});

// ─── Step 2: Twitter からのコールバック ──────────────────────────────────────────
router.get('/auth/twitter/callback', async (req, res) => {
  const { oauth_token, oauth_verifier, denied } = req.query as Record<string, string>;

  if (denied) {
    res.send(`
      <h2>❌ 認証がキャンセルされました</h2>
      <p>Twitter の認証ページで「キャンセル」が押されました。</p>
      <p><a href="/api/auth/twitter/start">やり直す</a></p>
    `);
    return;
  }

  const oauth_token_secret = pendingTokens.get(oauth_token);
  if (!oauth_token_secret) {
    res.status(400).send(`
      <h2>❌ セッションが見つかりません</h2>
      <p>最初からやり直してください。</p>
      <p><a href="/api/auth/twitter/start">やり直す</a></p>
    `);
    return;
  }

  try {
    const tempClient = new TwitterApi({
      appKey: process.env.TWITTER_API_KEY ?? '',
      appSecret: process.env.TWITTER_API_SECRET ?? '',
      accessToken: oauth_token,
      accessSecret: oauth_token_secret,
    });

    const { accessToken, accessSecret, screenName, userId } = await tempClient.login(oauth_verifier);

    pendingTokens.delete(oauth_token);

    res.send(`<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Twitter 認証成功</title>
  <style>
    body { font-family: sans-serif; max-width: 700px; margin: 40px auto; padding: 20px; background: #0f172a; color: #e2e8f0; }
    h2 { color: #4ade80; }
    .card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 24px; margin: 16px 0; }
    .label { color: #94a3b8; font-size: 0.85em; margin-bottom: 4px; }
    .value { font-family: monospace; background: #0f172a; padding: 10px 14px; border-radius: 6px; border: 1px solid #475569; word-break: break-all; font-size: 0.95em; color: #f1f5f9; cursor: pointer; }
    .value:hover { border-color: #60a5fa; }
    .copy-hint { color: #64748b; font-size: 0.75em; margin-top: 4px; }
    .step { background: #172033; border: 1px solid #1e3a5f; border-radius: 8px; padding: 16px; margin-top: 20px; }
    .step h3 { color: #60a5fa; margin: 0 0 8px; }
    code { background: #0f172a; padding: 2px 6px; border-radius: 4px; color: #f472b6; font-size: 0.9em; }
  </style>
</head>
<body>
  <h2>✅ 認証成功</h2>

  <div class="card">
    <div class="label">アカウント</div>
    <div class="value">@${screenName}</div>
  </div>

  <div class="card">
    <div class="label">User ID</div>
    <div class="value" onclick="navigator.clipboard.writeText('${userId}')" title="クリックでコピー">${userId}</div>
    <div class="copy-hint">クリックでコピー → TWITTER_USER_ID に設定</div>
  </div>

  <div class="card">
    <div class="label">Access Token</div>
    <div class="value" onclick="navigator.clipboard.writeText('${accessToken}')" title="クリックでコピー">${accessToken}</div>
    <div class="copy-hint">クリックでコピー → TWITTER_ACCESS_TOKEN に設定</div>
  </div>

  <div class="card">
    <div class="label">Access Token Secret</div>
    <div class="value" onclick="navigator.clipboard.writeText('${accessSecret}')" title="クリックでコピー">${accessSecret}</div>
    <div class="copy-hint">クリックでコピー → TWITTER_ACCESS_SECRET に設定</div>
  </div>

  <div class="step">
    <h3>次のステップ</h3>
    <ol>
      <li>上記 3つの値を Replit の「Secrets」に設定してください</li>
      <li><code>TWITTER_USER_ID</code>、<code>TWITTER_ACCESS_TOKEN</code>、<code>TWITTER_ACCESS_SECRET</code></li>
      <li>設定後、APIサーバーを再起動してください</li>
      <li>停止フラグを解除：<br><code>curl -X POST https://asset-manager-3-gomishu0930.replit.app/api/trigger/resume -H "x-trigger-secret: fanza-bot-trigger"</code></li>
    </ol>
  </div>

  <p style="color:#475569; font-size:0.8em; margin-top:32px;">
    ⚠️ このページを閉じるとトークンは表示されなくなります。必ずコピーしてください。
  </p>
</body>
</html>`);
  } catch (e: any) {
    res.status(500).send(`
      <h2>❌ トークン取得に失敗しました</h2>
      <pre>${e.message}</pre>
      <p><a href="/api/auth/twitter/start">やり直す</a></p>
    `);
  }
});

export default router;
