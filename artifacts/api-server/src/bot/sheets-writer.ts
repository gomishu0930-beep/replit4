/**
 * sheets-writer.ts — Google スプレッドシート自動記入
 *
 * 投稿・メトリクス・会議決定を Google Sheets に自動転記する。
 *
 * 【セットアップ方法（ユーザー向け）】
 * 1. Google Cloud Console でサービスアカウントを作成
 *    https://console.cloud.google.com/iam-admin/serviceaccounts
 * 2. 「キーを作成」→ JSON をダウンロード
 * 3. Replit シークレットに追加:
 *    - GOOGLE_SERVICE_ACCOUNT_JSON: ダウンロードしたJSONの中身（文字列）
 *    - GOOGLE_SHEET_ID: スプレッドシートのURL中の /d/XXXXX/ の部分
 * 4. そのスプレッドシートをサービスアカウントのメールアドレスに「編集者」として共有
 *
 * 【シートの構成】
 *   シート1: 投稿ログ (PostLog)
 *     A: 日時(JST) / B: 芸能人 / C: 作品タイトル / D: 投稿文(先頭80文字)
 *     E: tweetId / F: いいね / G: RT / H: インプ / I: クリック(Rebrandly)
 *   シート2: 週次メトリクス (WeeklyMetrics)
 *     A: 週 / B: 総投稿数 / C: 平均いいね / D: 平均インプ / E: 会議回数
 */

import { google } from 'googleapis';

const SHEET_ID = process.env.GOOGLE_SHEET_ID ?? '';
const SA_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? '';

// ─── クライアント初期化 ───────────────────────────────────────────────────────

function getAuthClient() {
  if (!SA_JSON || !SHEET_ID) {
    throw new Error('Google Sheets未設定: GOOGLE_SERVICE_ACCOUNT_JSON / GOOGLE_SHEET_ID が必要です');
  }
  const credentials = JSON.parse(SA_JSON);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return auth;
}

function getSheetsClient() {
  const auth = getAuthClient();
  return google.sheets({ version: 'v4', auth });
}

// ─── 投稿ログをシートに追記 ────────────────────────────────────────────────────

export interface PostLogEntry {
  postedAt: string;          // ISO8601 UTC
  celebrity?: string;        // 芸能人名（芸能人スロットのみ）
  itemTitle?: string;        // 作品タイトル
  tweetText: string;         // 投稿文
  tweetId: string;
  likes?: number;
  retweets?: number;
  impressions?: number;
  clicks?: number;           // Rebrandlyクリック数
  postType: string;          // celebrity / meeting-post / impression etc.
}

export async function appendPostLog(entry: PostLogEntry): Promise<void> {
  if (!SA_JSON || !SHEET_ID) {
    console.log('  ℹ️  [Sheets] 未設定のためスキップ (GOOGLE_SERVICE_ACCOUNT_JSON/GOOGLE_SHEET_ID)');
    return;
  }

  try {
    const sheets = getSheetsClient();
    const jst = new Date(new Date(entry.postedAt).getTime() + 9 * 3600000)
      .toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });

    const row = [
      jst,
      entry.celebrity ?? '',
      entry.itemTitle ?? '',
      entry.tweetText.slice(0, 80),
      entry.tweetId,
      entry.likes ?? '',
      entry.retweets ?? '',
      entry.impressions ?? '',
      entry.clicks ?? '',
      entry.postType,
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: 'PostLog!A:J',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [row] },
    });

    console.log(`  📊 [Sheets] 投稿ログ記録: ${entry.tweetId}`);
  } catch (e: any) {
    console.warn(`  ⚠ [Sheets] 書き込み失敗: ${e.message}`);
  }
}

// ─── メトリクス更新（投稿後のいいね/RT/インプ取得後に呼ぶ） ───────────────────

export async function updatePostMetrics(
  tweetId: string,
  metrics: { likes: number; retweets: number; impressions?: number; clicks?: number },
): Promise<void> {
  if (!SA_JSON || !SHEET_ID) return;

  try {
    const sheets = getSheetsClient();

    // tweetId で行を検索して更新
    const getResp = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'PostLog!A:E',
    });

    const rows = getResp.data.values ?? [];
    const rowIndex = rows.findIndex((r) => r[4] === tweetId);
    if (rowIndex < 0) {
      console.log(`  ℹ️  [Sheets] tweetId ${tweetId} が見つからないためメトリクス更新スキップ`);
      return;
    }

    const sheetRow = rowIndex + 1; // 1-indexed
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `PostLog!F${sheetRow}:I${sheetRow}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[
          metrics.likes,
          metrics.retweets,
          metrics.impressions ?? '',
          metrics.clicks ?? '',
        ]],
      },
    });

    console.log(`  📊 [Sheets] メトリクス更新: ${tweetId} ❤️${metrics.likes} RT${metrics.retweets}`);
  } catch (e: any) {
    console.warn(`  ⚠ [Sheets] メトリクス更新失敗: ${e.message}`);
  }
}

// ─── 会議決定事項をシートに追記 ───────────────────────────────────────────────

export interface DecisionLogEntry {
  decidedAt: string;
  source: string;          // 会議ID or 手動
  text: string;
  category: string;
  priority: string;
  autoExecuted: boolean;
  result?: string;
}

export async function appendDecisionLog(entry: DecisionLogEntry): Promise<void> {
  if (!SA_JSON || !SHEET_ID) return;

  try {
    const sheets = getSheetsClient();
    const jst = new Date(new Date(entry.decidedAt).getTime() + 9 * 3600000)
      .toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });

    const row = [
      jst,
      entry.source,
      entry.text.slice(0, 120),
      entry.category,
      entry.priority,
      entry.autoExecuted ? '自動実行' : '手動',
      entry.result ?? '',
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: 'DecisionLog!A:G',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [row] },
    });

    console.log(`  📊 [Sheets] 決定事項記録: "${entry.text.slice(0, 40)}"`);
  } catch (e: any) {
    console.warn(`  ⚠ [Sheets] 決定事項書き込み失敗: ${e.message}`);
  }
}

// ─── アカウントメトリクスをシートに追記 ───────────────────────────────────────

export interface AccountMetricsEntry {
  recordedAt: string;        // ISO8601 UTC
  followersCount: number;
  followingCount: number;
  tweetCount: number;
  avgImpressions: number;    // 直近7日間平均インプ（計測できない場合は0）
  totalPostsToday: number;
  note?: string;
}

export async function appendAccountMetrics(entry: AccountMetricsEntry): Promise<void> {
  if (!SA_JSON || !SHEET_ID) return;

  try {
    const sheets = getSheetsClient();
    const jst = new Date(new Date(entry.recordedAt).getTime() + 9 * 3600000)
      .toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });

    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: 'AccountMetrics!A:H',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[
          jst,
          entry.followersCount,
          entry.followingCount,
          entry.tweetCount,
          entry.avgImpressions || '',
          entry.totalPostsToday,
          entry.note ?? '',
        ]],
      },
    });

    console.log(`  📊 [Sheets] AccountMetrics記録: フォロワー${entry.followersCount}人`);
  } catch (e: any) {
    console.warn(`  ⚠ [Sheets] AccountMetrics書き込み失敗: ${e.message}`);
  }
}

export async function readAccountMetrics(limit = 14): Promise<Array<{
  recordedAt: string; followersCount: number; followingCount: number;
  tweetCount: number; avgImpressions: number; totalPostsToday: number; note: string;
}>> {
  if (!SA_JSON || !SHEET_ID) return [];
  try {
    const sheets = getSheetsClient();
    const resp = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: 'AccountMetrics!A:G' });
    const rows = resp.data.values ?? [];
    const dataRows = rows.length > 1 && rows[0][0] === '日時(JST)' ? rows.slice(1) : rows;
    return dataRows.slice(-limit).reverse().map(r => ({
      recordedAt:      r[0] ?? '',
      followersCount:  Number(r[1]) || 0,
      followingCount:  Number(r[2]) || 0,
      tweetCount:      Number(r[3]) || 0,
      avgImpressions:  Number(r[4]) || 0,
      totalPostsToday: Number(r[5]) || 0,
      note:            r[6] ?? '',
    }));
  } catch (e: any) {
    console.warn(`  ⚠ [Sheets] AccountMetrics読み込み失敗: ${e.message}`);
    return [];
  }
}

// ─── 仮説状態をシートに全上書き ───────────────────────────────────────────────

export interface HypothesisSheetRow {
  id: string;
  question: string;
  status: string;
  finding: string;
  adjustment: string;
  testedAt: string;
}

export async function upsertHypotheses(hypotheses: HypothesisSheetRow[]): Promise<void> {
  if (!SA_JSON || !SHEET_ID || hypotheses.length === 0) return;

  try {
    const sheets = getSheetsClient();
    const header = [['ID', '仮説', 'ステータス', '検証結果', '調整内容', '更新日時']];
    const dataRows = hypotheses.map(h => [
      h.id,
      h.question,
      h.status,
      h.finding.slice(0, 120),
      h.adjustment ?? '',
      h.testedAt ? new Date(new Date(h.testedAt).getTime() + 9 * 3600000).toLocaleString('ja-JP') : '',
    ]);

    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `Hypotheses!A1:F${1 + dataRows.length}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [...header, ...dataRows] },
    });

    console.log(`  📊 [Sheets] Hypotheses更新: ${hypotheses.length}件`);
  } catch (e: any) {
    console.warn(`  ⚠ [Sheets] Hypotheses書き込み失敗: ${e.message}`);
  }
}

export async function readHypotheses(): Promise<HypothesisSheetRow[]> {
  if (!SA_JSON || !SHEET_ID) return [];
  try {
    const sheets = getSheetsClient();
    const resp = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: 'Hypotheses!A:F' });
    const rows = resp.data.values ?? [];
    const dataRows = rows.length > 1 && rows[0][0] === 'ID' ? rows.slice(1) : rows;
    return dataRows.filter(r => r[0]).map(r => ({
      id:         r[0] ?? '',
      question:   r[1] ?? '',
      status:     r[2] ?? '',
      finding:    r[3] ?? '',
      adjustment: r[4] ?? '',
      testedAt:   r[5] ?? '',
    }));
  } catch (e: any) {
    console.warn(`  ⚠ [Sheets] Hypotheses読み込み失敗: ${e.message}`);
    return [];
  }
}

// ─── 週次会議ログをシートに追記 ────────────────────────────────────────────────

export interface MeetingLogEntry {
  meetingId: string;
  runAt: string;
  title: string;
  topicSummary: string;     // 議題サマリー（先頭120文字）
  totalDecisions: number;
  autoExecuted: number;
  autoSucceeded: number;
  manualItems: number;
  duration_min: number;
}

export async function appendMeetingLog(entry: MeetingLogEntry): Promise<void> {
  if (!SA_JSON || !SHEET_ID) return;

  try {
    const sheets = getSheetsClient();
    const jst = new Date(new Date(entry.runAt).getTime() + 9 * 3600000)
      .toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });

    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: 'MeetingLog!A:I',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[
          jst,
          entry.meetingId,
          entry.title,
          entry.topicSummary.slice(0, 120),
          entry.totalDecisions,
          entry.autoExecuted,
          entry.autoSucceeded,
          entry.manualItems,
          entry.duration_min,
        ]],
      },
    });

    console.log(`  📊 [Sheets] MeetingLog記録: ${entry.title}`);
  } catch (e: any) {
    console.warn(`  ⚠ [Sheets] MeetingLog書き込み失敗: ${e.message}`);
  }
}

export async function readMeetingLog(limit = 5): Promise<MeetingLogEntry[]> {
  if (!SA_JSON || !SHEET_ID) return [];
  try {
    const sheets = getSheetsClient();
    const resp = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: 'MeetingLog!A:I' });
    const rows = resp.data.values ?? [];
    const dataRows = rows.length > 1 && rows[0][0] === '日時(JST)' ? rows.slice(1) : rows;
    return dataRows.slice(-limit).reverse().map(r => ({
      meetingId:      r[1] ?? '',
      runAt:          r[0] ?? '',
      title:          r[2] ?? '',
      topicSummary:   r[3] ?? '',
      totalDecisions: Number(r[4]) || 0,
      autoExecuted:   Number(r[5]) || 0,
      autoSucceeded:  Number(r[6]) || 0,
      manualItems:    Number(r[7]) || 0,
      duration_min:   Number(r[8]) || 0,
    }));
  } catch (e: any) {
    console.warn(`  ⚠ [Sheets] MeetingLog読み込み失敗: ${e.message}`);
    return [];
  }
}

// ─── アルゴ解析結果をシートに追記 ─────────────────────────────────────────────

export interface AlgoInsightEntry {
  generatedAt: string;
  sampleSize: number;
  briefingSummary: string;  // 先頭200文字
}

export async function appendAlgoInsight(entry: AlgoInsightEntry): Promise<void> {
  if (!SA_JSON || !SHEET_ID) return;

  try {
    const sheets = getSheetsClient();
    const jst = new Date(new Date(entry.generatedAt).getTime() + 9 * 3600000)
      .toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });

    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: 'AlgoInsights!A:C',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[jst, entry.sampleSize, entry.briefingSummary.slice(0, 200)]],
      },
    });

    console.log(`  📊 [Sheets] AlgoInsights記録 (n=${entry.sampleSize})`);
  } catch (e: any) {
    console.warn(`  ⚠ [Sheets] AlgoInsights書き込み失敗: ${e.message}`);
  }
}

export async function readAlgoInsights(limit = 3): Promise<AlgoInsightEntry[]> {
  if (!SA_JSON || !SHEET_ID) return [];
  try {
    const sheets = getSheetsClient();
    const resp = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: 'AlgoInsights!A:C' });
    const rows = resp.data.values ?? [];
    const dataRows = rows.length > 1 && rows[0][0] === '日時(JST)' ? rows.slice(1) : rows;
    return dataRows.slice(-limit).reverse().map(r => ({
      generatedAt:     r[0] ?? '',
      sampleSize:      Number(r[1]) || 0,
      briefingSummary: r[2] ?? '',
    }));
  } catch (e: any) {
    console.warn(`  ⚠ [Sheets] AlgoInsights読み込み失敗: ${e.message}`);
    return [];
  }
}

// ─── シートの初期ヘッダーを作成（初回セットアップ時に呼ぶ） ──────────────────

export async function initSheetHeaders(): Promise<void> {
  if (!SA_JSON || !SHEET_ID) {
    console.log('  ℹ️  [Sheets] 未設定のためスキップ');
    return;
  }

  const REQUIRED_SHEETS = [
    { title: 'PostLog',        headers: ['日時(JST)', '芸能人', '作品タイトル', '投稿文(先頭80文字)', 'tweetId', 'いいね', 'RT', 'インプレッション', 'クリック(Rebrandly)', '投稿種別'] },
    { title: 'DecisionLog',    headers: ['日時(JST)', 'ソース', '決定事項', 'カテゴリ', '優先度', '実行方法', '結果'] },
    { title: 'AccountMetrics', headers: ['日時(JST)', 'フォロワー', 'フォロー中', 'ツイート数', '平均インプ(7日)', '本日投稿数', 'メモ'] },
    { title: 'Hypotheses',     headers: ['ID', '仮説', 'ステータス', '検証結果', '調整内容', '更新日時'] },
    { title: 'MeetingLog',     headers: ['日時(JST)', '会議ID', 'タイトル', '議題サマリー', '決定数', '自動実行数', '自動成功数', '手動確認数', '所要時間(分)'] },
    { title: 'AlgoInsights',   headers: ['日時(JST)', 'サンプル数', '解析サマリー(先頭200文字)'] },
  ];

  try {
    const sheets = getSheetsClient();

    // 1. 既存シート一覧を取得
    const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
    const existingTitles = new Set(
      (meta.data.sheets ?? []).map((s: any) => s.properties?.title ?? ''),
    );

    // 2. 存在しないシートを作成
    const missing = REQUIRED_SHEETS.filter(s => !existingTitles.has(s.title));
    if (missing.length > 0) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SHEET_ID,
        requestBody: {
          requests: missing.map(s => ({
            addSheet: { properties: { title: s.title } },
          })),
        },
      });
      console.log(`  📊 [Sheets] シート作成: ${missing.map(s => s.title).join(', ')}`);
    }

    // 3. 全シートのヘッダー行を書き込み（冪等）
    for (const s of REQUIRED_SHEETS) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `${s.title}!A1:${String.fromCharCode(64 + s.headers.length)}1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [s.headers] },
      });
    }

    console.log('  ✅ [Sheets] 全シートヘッダー初期化完了 (6タブ)');
  } catch (e: any) {
    const saEmail = (() => {
      try { return JSON.parse(SA_JSON).client_email ?? '不明'; } catch { return '解析失敗'; }
    })();
    console.warn(`  ⚠ [Sheets] ヘッダー初期化失敗: ${e.message}`);
    console.warn(`  ℹ️  [Sheets診断] SHEET_ID先頭8文字: ${SHEET_ID.slice(0, 8)}...`);
    console.warn(`  ℹ️  [Sheets診断] サービスアカウント: ${saEmail}`);
    console.warn(`  ℹ️  [Sheets診断] → このアカウントをスプレッドシートの「編集者」として共有してください`);
  }
}

export async function diagnoseSheetsConnection(): Promise<{ ok: boolean; sheetIdPrefix: string; serviceAccount: string; error?: string; existingTabs?: string[] }> {
  const saEmail = (() => {
    try { return JSON.parse(SA_JSON).client_email ?? '不明'; } catch { return '解析失敗'; }
  })();
  const sheetIdPrefix = SHEET_ID.slice(0, 12) + '...';

  if (!SA_JSON || !SHEET_ID) {
    return { ok: false, sheetIdPrefix, serviceAccount: saEmail, error: 'GOOGLE_SERVICE_ACCOUNT_JSON または GOOGLE_SHEET_ID が未設定' };
  }

  try {
    const sheets = getSheetsClient();
    const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
    const existingTabs = (meta.data.sheets ?? []).map((s: any) => s.properties?.title ?? '');
    return { ok: true, sheetIdPrefix, serviceAccount: saEmail, existingTabs };
  } catch (e: any) {
    return { ok: false, sheetIdPrefix, serviceAccount: saEmail, error: e.message };
  }
}

export function isSheetsConfigured(): boolean {
  return Boolean(SA_JSON && SHEET_ID);
}

// ─── PostLog を読み込む（会議コンテキスト用） ───────────────────────────────────

export interface PostLogRow {
  postedAt: string;
  celebrity: string;
  itemTitle: string;
  tweetText: string;
  tweetId: string;
  likes: number;
  retweets: number;
  impressions: number;
  clicks: number;
  postType: string;
}

export async function readPostLog(limit = 20): Promise<PostLogRow[]> {
  if (!SA_JSON || !SHEET_ID) return [];

  try {
    const sheets = getSheetsClient();
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'PostLog!A:J',
    });

    const rows = resp.data.values ?? [];
    // 1行目がヘッダーの場合はスキップ
    const dataRows = rows.length > 1 && rows[0][0] === '日時(JST)' ? rows.slice(1) : rows;

    return dataRows
      .slice(-limit)
      .reverse()
      .map((r) => ({
        postedAt:    r[0] ?? '',
        celebrity:   r[1] ?? '',
        itemTitle:   r[2] ?? '',
        tweetText:   r[3] ?? '',
        tweetId:     r[4] ?? '',
        likes:       Number(r[5]) || 0,
        retweets:    Number(r[6]) || 0,
        impressions: Number(r[7]) || 0,
        clicks:      Number(r[8]) || 0,
        postType:    r[9] ?? '',
      }));
  } catch (e: any) {
    console.warn(`  ⚠ [Sheets] PostLog読み込み失敗: ${e.message}`);
    return [];
  }
}

// ─── DecisionLog を読み込む（会議コンテキスト用） ──────────────────────────────

export interface DecisionLogRow {
  decidedAt: string;
  source: string;
  text: string;
  category: string;
  priority: string;
  executionType: string;
  result: string;
}

export async function readDecisionLog(limit = 15): Promise<DecisionLogRow[]> {
  if (!SA_JSON || !SHEET_ID) return [];

  try {
    const sheets = getSheetsClient();
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'DecisionLog!A:G',
    });

    const rows = resp.data.values ?? [];
    const dataRows = rows.length > 1 && rows[0][0] === '日時(JST)' ? rows.slice(1) : rows;

    return dataRows
      .slice(-limit)
      .reverse()
      .map((r) => ({
        decidedAt:     r[0] ?? '',
        source:        r[1] ?? '',
        text:          r[2] ?? '',
        category:      r[3] ?? '',
        priority:      r[4] ?? '',
        executionType: r[5] ?? '',
        result:        r[6] ?? '',
      }));
  } catch (e: any) {
    console.warn(`  ⚠ [Sheets] DecisionLog読み込み失敗: ${e.message}`);
    return [];
  }
}
