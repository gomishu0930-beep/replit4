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

  /** シャドウバン回復進捗レポート（23:00 日次） */
  recoveryProgress: (avgImpressions: number, trend: string, daysAboveThreshold: number) =>
    notifyAlert({
      level: 'INFO',
      title: `📊 回復チェック: 平均インプ ${avgImpressions}`,
      body: [
        `直近7日間の平均インプレッション: ${avgImpressions}`,
        `トレンド: ${trend}`,
        `閾値(30)以上の継続日数: ${daysAboveThreshold}日`,
        '',
        daysAboveThreshold >= 7
          ? '✅ 7日連続で閾値超え → 投稿数増加を検討してください'
          : `あと ${7 - daysAboveThreshold} 日継続で回復モード解除の目安です`,
      ].join('\n'),
    }),

  /** 回復検知（閾値を7日連続で超えた） */
  recoveryDetected: (avgImpressions: number) =>
    notifyAlert({
      level: 'WARN',
      title: '🎉 シャドウバン回復を検知！',
      body: [
        `平均インプレッションが 30 を7日連続で超えました。`,
        `現在の平均: ${avgImpressions}`,
        '',
        '【推奨アクション】',
        '① ダッシュボードでトレンドを確認',
        '② 問題なければ投稿数を 2本/日 → 4本/日 に増やす',
        '③ さらに2週間様子を見て 8本/日 へ段階的に移行',
      ].join('\n'),
    }),

  /** フォロワー数 有意な変動アラート（日次 09:00 JST） */
  followerChange: (current: number, previous: number, delta: number) =>
    notifyAlert({
      level: delta >= 0 ? 'INFO' : 'WARN',
      title: `${delta >= 0 ? '📈' : '📉'} フォロワー変動: ${delta >= 0 ? '+' : ''}${delta}人`,
      body: [
        `昨日比: ${delta >= 0 ? '+' : ''}${delta}人`,
        `現在: ${current}人 / 前日: ${previous}人`,
        '',
        delta <= -10
          ? '⚠️ 10人以上の減少 → シャドウバン悪化の可能性があります。投稿スタイルを確認してください。'
          : delta >= 10
          ? '✅ 10人以上の増加 → 回復兆候の可能性があります。'
          : '通常範囲の変動です。',
      ].join('\n'),
    }),

  /** Xアルゴリズム週次解析ブリーフィング（日曜 23:30 JST 自動） */
  algoWeeklyBriefing: (briefing: string, sampleSize: number) =>
    notifyAlert({
      level: 'INFO',
      title: `📡 Xアルゴリズム週次解析レポート (n=${sampleSize}件)`,
      body: briefing,
    }),

  /** Rebrandlyクリック数 週次サマリー（月曜 08:00 JST に追加） */
  rebrandlyWeeklySummary: (totalClicks: number, topLinks: Array<{ title: string; clicks: number }>) =>
    notifyAlert({
      level: 'INFO',
      title: `🔗 Rebrandly週次クリックサマリー: ${totalClicks}クリック`,
      body: [
        `累計総クリック数: ${totalClicks}`,
        '',
        '【クリック数TOP3】',
        ...topLinks.slice(0, 3).map((l, i) => `${i + 1}. ${l.title}: ${l.clicks}クリック`),
      ].join('\n'),
    }),

  /** 手動投稿週次フィードバック（月曜 08:00 JST） */
  manualPostFeedback: (fb: {
    weekStart: string;
    weekEnd: string;
    tweetCount: number;
    avgEngagement: number;
    analysis: string;
    suggestions: string[];
    hookVariety: string[];
    topTweet: { text: string; likes: number; rt: number };
  }) =>
    notifyAlert({
      level: 'INFO',
      title: `📝 手動投稿週次FB (${fb.weekStart} 〜 ${fb.weekEnd})`,
      body: [
        `分析ツイート数: ${fb.tweetCount}件 / 平均エンゲージメント: ${fb.avgEngagement}pt`,
        '',
        `【全体評価】`,
        fb.analysis,
        '',
        `【使ったフック型】`,
        fb.hookVariety.join(' / '),
        '',
        `【今週のベスト投稿】`,
        `${fb.topTweet.text.slice(0, 80)}...`,
        `❤️${fb.topTweet.likes} 🔁${fb.topTweet.rt}`,
        '',
        `【改善提案】`,
        ...fb.suggestions.map((s, i) => `${i + 1}. ${s}`),
      ].join('\n'),
    }),

  /** Xアルゴニュース発見通知（月曜 08:30 JST 自動） */
  algoNewsAlert: (pendingCount: number, topFindings: Array<{ title: string; confidence: string; sourceDesc: string }>) =>
    notifyAlert({
      level: 'INFO',
      title: `📡 Xアルゴ新情報: ${pendingCount}件の発見`,
      body: [
        `今週のXアルゴリズム情報収集で ${pendingCount}件の新発見がありました。`,
        'ダッシュボード「📡 アルゴ解析」→「🆕 新発見」タブで確認・採否をお決めください。',
        '',
        '【トップ3 発見】',
        ...topFindings.slice(0, 3).map((f, i) =>
          `${i + 1}. [${f.confidence}] ${f.title}\n   出典: ${f.sourceDesc}`
        ),
      ].join('\n'),
    }),
};
