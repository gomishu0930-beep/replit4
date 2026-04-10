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

// ─── シートの初期ヘッダーを作成（初回セットアップ時に呼ぶ） ──────────────────

export async function initSheetHeaders(): Promise<void> {
  if (!SA_JSON || !SHEET_ID) {
    console.log('  ℹ️  [Sheets] 未設定のためスキップ');
    return;
  }

  try {
    const sheets = getSheetsClient();

    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: 'PostLog!A1:J1',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [['日時(JST)', '芸能人', '作品タイトル', '投稿文(先頭80文字)', 'tweetId', 'いいね', 'RT', 'インプレッション', 'クリック(Rebrandly)', '投稿種別']],
      },
    });

    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: 'DecisionLog!A1:G1',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [['日時(JST)', 'ソース', '決定事項', 'カテゴリ', '優先度', '実行方法', '結果']],
      },
    });

    console.log('  ✅ [Sheets] ヘッダー初期化完了');
  } catch (e: any) {
    console.warn(`  ⚠ [Sheets] ヘッダー初期化失敗: ${e.message}`);
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
