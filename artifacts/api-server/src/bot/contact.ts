/**
 * contact.ts — 連絡チーム
 *
 * 有事の際に gomishu0930@icloud.com へ自動メール通知を送る。
 * Gmail のアプリパスワードを使用（SMTP_USER / SMTP_PASS 環境変数）。
 * 環境変数が未設定の場合はコンソールログのみ（サイレント動作）。
 */

import nodemailer from 'nodemailer';

const OWNER_EMAIL = 'gomishu0930@icloud.com';

type AlertLevel = 'INFO' | 'WARN' | 'CRITICAL';

interface Alert {
  level: AlertLevel;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

// ─── 最後に送ったアラートのキャッシュ（同一エラーの連投防止）──────────────

const recentAlerts = new Map<string, number>(); // key → 最後送信時刻(ms)
const ALERT_COOLDOWN_MS = 60 * 60 * 1000; // 同一アラートは1時間以内に再送しない

function shouldSend(key: string): boolean {
  const last = recentAlerts.get(key) ?? 0;
  return Date.now() - last > ALERT_COOLDOWN_MS;
}

// ─── メール送信 ────────────────────────────────────────────────────────────

async function sendEmail(alert: Alert): Promise<void> {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!user || !pass) return; // 設定なし → サイレント

  const transport = nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  });

  const levelEmoji = alert.level === 'CRITICAL' ? '🚨' : alert.level === 'WARN' ? '⚠️' : 'ℹ️';
  const jst = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });

  const dataSection = alert.data
    ? `\n\n【詳細データ】\n${JSON.stringify(alert.data, null, 2)}`
    : '';

  await transport.sendMail({
    from: `"FANZA Bot 連絡チーム" <${user}>`,
    to: OWNER_EMAIL,
    subject: `${levelEmoji} [FANZABot] ${alert.title}`,
    text: [
      `発生時刻: ${jst}`,
      `レベル: ${alert.level}`,
      ``,
      alert.body,
      dataSection,
      ``,
      `─────────────────────────────`,
      `FANZA X Bot 連絡チーム`,
    ].join('\n'),
  });
}

// ─── 公開API ───────────────────────────────────────────────────────────────

export async function notifyAlert(alert: Alert): Promise<void> {
  const key = `${alert.level}:${alert.title}`;
  const jst = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });

  // 常にコンソールには出力
  const prefix = alert.level === 'CRITICAL' ? '🚨' : alert.level === 'WARN' ? '⚠️' : 'ℹ️';
  console.log(`  ${prefix} [連絡チーム] ${alert.level}: ${alert.title}`);

  if (!shouldSend(key)) {
    console.log(`    (クールダウン中 → メール送信スキップ)`);
    return;
  }

  recentAlerts.set(key, Date.now());

  try {
    await sendEmail(alert);
    if (process.env.SMTP_USER) {
      console.log(`    ✉️ ${OWNER_EMAIL} にメール送信完了 [${jst}]`);
    }
  } catch (e: any) {
    console.warn(`    メール送信失敗: ${e.message}`);
  }
}

// ─── よく使う通知ショートカット ─────────────────────────────────────────────

export const contact = {
  /** 投稿が連続失敗した場合 */
  postingFailed: (slotLabel: string, error: string) =>
    notifyAlert({
      level: 'CRITICAL',
      title: `投稿失敗: ${slotLabel}`,
      body: `スロット「${slotLabel}」の投稿が失敗しました。\n\nエラー: ${error}`,
    }),

  /** Twitter API レート制限エラー */
  rateLimitHit: (endpoint: string) =>
    notifyAlert({
      level: 'WARN',
      title: 'Twitter APIレート制限',
      body: `エンドポイント "${endpoint}" でレート制限に達しました。\n次のサイクルまで自動待機します。`,
    }),

  /** アカウント凍結の可能性（403/401 が多発） */
  suspensionRisk: (details: string) =>
    notifyAlert({
      level: 'CRITICAL',
      title: 'アカウント凍結リスク',
      body: `Twitter APIから疑わしいエラーが発生しています。\n確認してください。\n\n${details}`,
    }),

  /** GCS保存失敗 */
  storageFailed: (file: string, error: string) =>
    notifyAlert({
      level: 'WARN',
      title: `ストレージ保存失敗: ${file}`,
      body: `GCSへの保存が失敗しました。ローカルのみで動作中。\n\nファイル: ${file}\nエラー: ${error}`,
    }),

  /** テンプレート進化 成功報告 (INFO) */
  templateEvolved: (count: number, avgScore: number) =>
    notifyAlert({
      level: 'INFO',
      title: `テンプレート進化完了: ${count}件`,
      body: `外部データを元に新テンプレートが${count}件生成・保存されました。\n平均スコア: ${avgScore}`,
    }),

  /** 週次パフォーマンスレポート */
  weeklyReport: (stats: Record<string, unknown>) =>
    notifyAlert({
      level: 'INFO',
      title: '週次パフォーマンスレポート',
      body: `直近1週間の運用成果をお知らせします。`,
      data: stats,
    }),
};
