/**
 * storage.ts — 投稿データ / 外部パターンの永続管理
 *
 * - 起動時に GCS から読み込み → インメモリキャッシュで高速アクセス
 * - 書き込みは ローカルファイル（即時）+ GCS（非同期）の二重保存
 * - GCS が使えない環境ではローカルファイルのみで動作（フォールバック）
 */
import { readJson, writeJson } from './cloudStore.js';

// ─── 型定義 ──────────────────────────────────────────────────────────────────

interface PostMetrics {
  like_count: number;
  retweet_count: number;
  reply_count?: number;
  bookmark_count?: number;
  impression_count?: number;
  checkedAt: string;
}

// ─── 日次インプレッション記録型（回復チェック用）──────────────────────────────

interface DailyImpressionSnapshot {
  date: string;           // YYYY-MM-DD in JST
  avgImpressions: number; // その日の全投稿の平均インプレッション数
  postsChecked: number;   // 計算に使用した投稿数
}

interface RecoverySnapshotsData {
  snapshots: DailyImpressionSnapshot[];
}

interface PostRecord {
  tweetId: string;
  replyId: string;
  type: string;
  contentType?: string;  // 5型分類: レビュー型/比較型/ランキング型/失敗回避型/共感型
  text: string;
  item: { id: string; title: string; affiliateURL: string };
  postedAt: string;
  metrics: PostMetrics | null;
}

interface PostsData {
  posts: PostRecord[];
}

export interface ExternalPattern {
  tweetId: string;
  text: string;
  authorId: string;
  like_count: number;
  retweet_count: number;
  reply_count: number;
  bookmark_count: number;
  impression_count: number;
  score: number;
  source: string;
  savedAt: string;
}

interface ExternalPatternsData {
  patterns: ExternalPattern[];
  lastRefreshedAt: string | null;
  queries: string[];
}

// ─── アカウントスナップショット型（週次フォロワー推移）───────────────────────

export interface AccountSnapshot {
  recordedAt: string;
  followersCount: number;
  followingCount: number;
  tweetCount: number;
  note?: string;           // 手動メモ（例: "シャドウバン解除確認"）
}

interface SnapshotData {
  snapshots: AccountSnapshot[];
}

// ─── 手動観察ログ型（他アカウント・他投稿の観察記録）────────────────────────

export interface ManualObservation {
  id: string;
  recordedAt: string;
  category: 'engagement' | 'product' | 'safe-post' | 'other';
  // engagement: いいね・RTが取れた投稿パターン
  // product:    良かった作品の特徴
  // safe-post:  凍結回避できた投稿スタイル
  source?: string;          // 参照アカウント (@xxx) や作品名
  observation: string;      // 観察内容（自由記述）
  hypothesis?: string;      // 「〜ではないか」という仮説
  priority: 'high' | 'medium' | 'low';
}

interface ObservationsData {
  observations: ManualObservation[];
}

// ─── 動的テンプレート型 ───────────────────────────────────────────────────────

export interface DynamicTemplate {
  text: string;             // テンプレート文字列（{actress}等のプレースホルダーあり）
  type: string;             // 対応スロット種別（amateur/rank/sale/buzz/random/any）
  sourceScore: number;      // 生成元外部パターンの平均スコア
  generatedAt: string;
  usedCount: number;        // 実際に使われた回数
}

interface DynamicTemplatesData {
  templates: DynamicTemplate[];
  lastEvolvedAt: string | null;
  evolutionCount: number;
}

// ─── インメモリキャッシュ ─────────────────────────────────────────────────────

let postsCache: PostsData = { posts: [] };
let extCache: ExternalPatternsData = { patterns: [], lastRefreshedAt: null, queries: [] };
let dynTemplatesCache: DynamicTemplatesData = { templates: [], lastEvolvedAt: null, evolutionCount: 0 };
let snapshotCache: SnapshotData = { snapshots: [] };
let observationsCache: ObservationsData = { observations: [] };
let recoverySnapshotsCache: RecoverySnapshotsData = { snapshots: [] };
let initialized = false;

// ─── 初期化（起動時に1回だけ呼ぶ）───────────────────────────────────────────

export async function initStorage(): Promise<void> {
  if (initialized) return;
  console.log('  📦 ストレージ初期化: GCSからデータを読み込み中...');
  postsCache    = await readJson<PostsData>('posts.json', { posts: [] });
  extCache      = await readJson<ExternalPatternsData>('external-patterns.json', {
    patterns: [], lastRefreshedAt: null, queries: [],
  });
  dynTemplatesCache = await readJson<DynamicTemplatesData>('dynamic-templates.json', {
    templates: [], lastEvolvedAt: null, evolutionCount: 0,
  });
  snapshotCache          = await readJson<SnapshotData>('account-snapshots.json', { snapshots: [] });
  observationsCache      = await readJson<ObservationsData>('observations.json', { observations: [] });
  recoverySnapshotsCache = await readJson<RecoverySnapshotsData>('recovery-snapshots.json', { snapshots: [] });
  schedulerStateCache    = await readJson<SchedulerStateData>('scheduler-state.json', { celebPostedDate: '' });
  manualFeedbackCache    = await readJson<ManualFeedbackData>('manual-feedback.json', { feedbacks: [] });
  rebrandlyCache         = await readJson<RebrandlyData>('rebrandly.json', { links: [], lastSyncedAt: null });
  algoInsightCache       = await readJson<AlgoInsightData>('algo-insights.json', { insights: [] });
  initialized = true;
  console.log(
    `  ✅ ストレージ初期化完了 (投稿: ${postsCache.posts.length}件 / 外部パターン: ${extCache.patterns.length}件 / 動的テンプレート: ${dynTemplatesCache.templates.length}件 / スナップショット: ${snapshotCache.snapshots.length}件 / 観察ログ: ${observationsCache.observations.length}件 / 手動FB: ${manualFeedbackCache.feedbacks.length}件 / Rebrandlyリンク: ${rebrandlyCache.links.length}件 / アルゴ解析: ${algoInsightCache.insights.length}件)`,
  );
}

// ─── Posts ────────────────────────────────────────────────────────────────────

function savePostsAsync() {
  writeJson('posts.json', postsCache).catch((e: any) =>
    console.warn('  ⚠ posts.json 保存失敗:', e.message),
  );
}

export function recordPost({ tweetId, replyId, item, text, type, contentType }: {
  tweetId: string; replyId: string; item?: any; text: string; type: string; contentType?: string;
}) {
  postsCache.posts.push({
    tweetId, replyId, type, contentType, text,
    item: item
      ? { id: item.content_id, title: item.title, affiliateURL: item.affiliateURL }
      : { id: '', title: '', affiliateURL: '' },
    postedAt: new Date().toISOString(),
    metrics: null,
  });
  savePostsAsync();
}

export function getRecentlyPostedIds(days = 30): Set<string> {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const ids = new Set<string>();
  for (const p of postsCache.posts) {
    if (new Date(p.postedAt).getTime() > cutoff && p.item?.id) {
      ids.add(p.item.id);
    }
  }
  return ids;
}

export function updateMetrics(tweetId: string, metrics: any) {
  const post = postsCache.posts.find((p) => p.tweetId === tweetId);
  if (post) {
    post.metrics = { ...metrics, checkedAt: new Date().toISOString() };
    savePostsAsync();
  }
}

export function getTopPatterns(limit = 10): PostRecord[] {
  const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const withMetrics = postsCache.posts.filter(
    (p) => p.metrics && new Date(p.postedAt).getTime() > oneWeekAgo,
  );
  withMetrics.sort((a, b) => {
    const score = (m: PostMetrics) =>
      (m.like_count || 0) + (m.retweet_count || 0) * 3 +
      (m.bookmark_count || 0) * 2 + (m.reply_count || 0);
    return score(b.metrics!) - score(a.metrics!);
  });
  return withMetrics.slice(0, limit);
}

export function getRecentPostIds(days = 7): string[] {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return postsCache.posts
    .filter((p) => p.tweetId && new Date(p.postedAt).getTime() > cutoff)
    .map((p) => p.tweetId);
}

export function getAllPosts(): PostRecord[] {
  return postsCache.posts;
}

export function getPostsAfter(since: Date): PostRecord[] {
  return postsCache.posts.filter((p) => new Date(p.postedAt) >= since);
}

export function getStats() {
  const posts = postsCache.posts;
  const last7 = posts.filter(
    (p) => new Date(p.postedAt).getTime() > Date.now() - 7 * 24 * 60 * 60 * 1000,
  );
  const lastPost = posts.length > 0 ? posts[posts.length - 1] : null;
  const withMetrics = posts.filter((p) => p.metrics);
  const totalLikes = withMetrics.reduce((sum, p) => sum + (p.metrics?.like_count || 0), 0);
  const totalRTs = withMetrics.reduce((sum, p) => sum + (p.metrics?.retweet_count || 0), 0);
  return {
    totalPosts: posts.length,
    postsLast7Days: last7.length,
    lastPostedAt: lastPost?.postedAt ?? null,
    lastPostTitle: lastPost?.item?.title ?? null,
    totalLikes,
    totalRetweets: totalRTs,
  };
}

// ─── External Patterns ────────────────────────────────────────────────────────

function saveExtAsync() {
  writeJson('external-patterns.json', extCache).catch((e: any) =>
    console.warn('  ⚠ external-patterns.json 保存失敗:', e.message),
  );
}

export function upsertExternalPatterns(
  incoming: Omit<ExternalPattern, 'savedAt'>[],
  source: string,
) {
  const existingIds = new Set(extCache.patterns.map((p) => p.tweetId));
  let added = 0;
  for (const p of incoming) {
    if (!existingIds.has(p.tweetId)) {
      extCache.patterns.push({ ...p, source, savedAt: new Date().toISOString() });
      added++;
    } else {
      const existing = extCache.patterns.find((e) => e.tweetId === p.tweetId);
      if (existing) {
        existing.like_count = p.like_count;
        existing.retweet_count = p.retweet_count;
        existing.bookmark_count = p.bookmark_count;
        existing.impression_count = p.impression_count;
        existing.score = p.score;
      }
    }
  }
  extCache.patterns.sort((a, b) => b.score - a.score);
  extCache.patterns = extCache.patterns.slice(0, 100);
  extCache.lastRefreshedAt = new Date().toISOString();
  if (source && !extCache.queries.includes(source)) extCache.queries.push(source);
  saveExtAsync();
  return added;
}

export function getExternalTopPatterns(limit = 10): ExternalPattern[] {
  return extCache.patterns.slice(0, limit);
}

// ─── Dynamic Templates ────────────────────────────────────────────────────────

function saveDynTemplatesAsync() {
  writeJson('dynamic-templates.json', dynTemplatesCache).catch((e: any) =>
    console.warn('  ⚠ dynamic-templates.json 保存失敗:', e.message),
  );
}

export function upsertDynamicTemplates(newTemplates: Omit<DynamicTemplate, 'usedCount'>[]) {
  for (const t of newTemplates) {
    dynTemplatesCache.templates.push({ ...t, usedCount: 0 });
  }
  // 最新100件に絞る（使用回数が多いものを優先残留）
  dynTemplatesCache.templates.sort((a, b) => b.sourceScore - a.sourceScore);
  dynTemplatesCache.templates = dynTemplatesCache.templates.slice(0, 100);
  dynTemplatesCache.lastEvolvedAt = new Date().toISOString();
  dynTemplatesCache.evolutionCount++;
  saveDynTemplatesAsync();
}

export function getDynamicTemplates(type?: string, limit = 5): DynamicTemplate[] {
  const pool = type
    ? dynTemplatesCache.templates.filter((t) => t.type === type || t.type === 'any')
    : dynTemplatesCache.templates;
  // 使用回数が少ないものを優先（まんべんなく使う）
  return [...pool].sort((a, b) => a.usedCount - b.usedCount).slice(0, limit);
}

export function recordDynamicTemplateUsed(text: string) {
  const t = dynTemplatesCache.templates.find((t) => t.text === text);
  if (t) {
    t.usedCount++;
    saveDynTemplatesAsync();
  }
}

export function getDynamicTemplatesInfo() {
  return {
    count: dynTemplatesCache.templates.length,
    lastEvolvedAt: dynTemplatesCache.lastEvolvedAt,
    evolutionCount: dynTemplatesCache.evolutionCount,
    topTemplates: dynTemplatesCache.templates.slice(0, 5).map((t) => ({
      type: t.type,
      preview: t.text.slice(0, 40),
      usedCount: t.usedCount,
      sourceScore: t.sourceScore,
    })),
  };
}

// ─── Account Snapshots ─────────────────────────────────────────────────────────

function saveSnapshotsAsync() {
  writeJson('account-snapshots.json', snapshotCache).catch((e: any) =>
    console.warn('  ⚠ account-snapshots.json 保存失敗:', e.message),
  );
}

export function recordAccountSnapshot(snap: Omit<AccountSnapshot, 'recordedAt'> & { note?: string }) {
  snapshotCache.snapshots.push({
    ...snap,
    recordedAt: new Date().toISOString(),
  });
  // 最新52件（約1年分）を保持
  snapshotCache.snapshots = snapshotCache.snapshots.slice(-52);
  saveSnapshotsAsync();
  console.log(`  📊 アカウントスナップショット記録: フォロワー ${snap.followersCount}人`);
}

export function getAccountSnapshots(): AccountSnapshot[] {
  return snapshotCache.snapshots;
}

export function getLatestSnapshot(): AccountSnapshot | null {
  return snapshotCache.snapshots.at(-1) ?? null;
}

// ─── Manual Observations ────────────────────────────────────────────────────────

function saveObservationsAsync() {
  writeJson('observations.json', observationsCache).catch((e: any) =>
    console.warn('  ⚠ observations.json 保存失敗:', e.message),
  );
}

export function addObservation(obs: Omit<ManualObservation, 'id' | 'recordedAt'>): ManualObservation {
  const newObs: ManualObservation = {
    ...obs,
    id: `obs-${Date.now()}`,
    recordedAt: new Date().toISOString(),
  };
  observationsCache.observations.unshift(newObs);
  // 最新200件を保持
  observationsCache.observations = observationsCache.observations.slice(0, 200);
  saveObservationsAsync();
  return newObs;
}

export function getObservations(category?: ManualObservation['category']): ManualObservation[] {
  if (category) {
    return observationsCache.observations.filter((o) => o.category === category);
  }
  return observationsCache.observations;
}

export function deleteObservation(id: string): boolean {
  const before = observationsCache.observations.length;
  observationsCache.observations = observationsCache.observations.filter((o) => o.id !== id);
  if (observationsCache.observations.length < before) {
    saveObservationsAsync();
    return true;
  }
  return false;
}

export function getExternalPatternsInfo() {
  return {
    count: extCache.patterns.length,
    lastRefreshedAt: extCache.lastRefreshedAt,
    queries: extCache.queries,
    topPatterns: extCache.patterns.slice(0, 10),
  };
}

// ─── Recovery Snapshots（日次インプレッション回復追跡）──────────────────────────

function saveRecoverySnapshotsAsync() {
  writeJson('recovery-snapshots.json', recoverySnapshotsCache).catch((e: any) =>
    console.warn('  ⚠ recovery-snapshots.json 保存失敗:', e.message),
  );
}

export function recordDailyImpressionAvg(avgImpressions: number, postsChecked: number): void {
  // JST 日付（YYYY-MM-DD）
  const nowJst = new Date(Date.now() + 9 * 3600000);
  const date = nowJst.toISOString().slice(0, 10);

  // 同日エントリーがあれば更新、なければ追加
  const existing = recoverySnapshotsCache.snapshots.find((s) => s.date === date);
  if (existing) {
    existing.avgImpressions = avgImpressions;
    existing.postsChecked   = postsChecked;
  } else {
    recoverySnapshotsCache.snapshots.push({ date, avgImpressions, postsChecked });
  }

  // 最新90日分を保持
  recoverySnapshotsCache.snapshots = recoverySnapshotsCache.snapshots.slice(-90);
  saveRecoverySnapshotsAsync();
}

export function getDailyImpressionSnapshots(days = 7): DailyImpressionSnapshot[] {
  return recoverySnapshotsCache.snapshots.slice(-days);
}

// ─── Scheduler State（再起動を跨いで状態を保持）────────────────────────────────
// celebPostedDate: 今日すでに芸能人スロットを投稿済みかを管理
// ─── 手動投稿フィードバック履歴 ─────────────────────────────────────────────

export interface ManualPostFeedback {
  id: string;
  generatedAt: string;
  weekStart: string;
  weekEnd: string;
  tweetCount: number;
  avgEngagement: number;
  topTweet: { text: string; likes: number; rt: number };
  analysis: string;
  suggestions: string[];
  hookVariety: string[];
}

interface ManualFeedbackData {
  feedbacks: ManualPostFeedback[];
}

let manualFeedbackCache: ManualFeedbackData = { feedbacks: [] };

function saveManualFeedbackAsync() {
  writeJson('manual-feedback.json', manualFeedbackCache).catch((e: any) =>
    console.warn('  ⚠ manual-feedback.json 保存失敗:', e.message),
  );
}

export function recordManualFeedback(fb: Omit<ManualPostFeedback, 'id' | 'generatedAt'>): ManualPostFeedback {
  const newFb: ManualPostFeedback = {
    ...fb,
    id: `fb-${Date.now()}`,
    generatedAt: new Date().toISOString(),
  };
  manualFeedbackCache.feedbacks.unshift(newFb);
  manualFeedbackCache.feedbacks = manualFeedbackCache.feedbacks.slice(0, 52);
  saveManualFeedbackAsync();
  return newFb;
}

export function getManualFeedbacks(limit = 10): ManualPostFeedback[] {
  return manualFeedbackCache.feedbacks.slice(0, limit);
}

export function getLatestManualFeedback(): ManualPostFeedback | null {
  return manualFeedbackCache.feedbacks[0] ?? null;
}

// ─── アルゴリズム解析インサイト ────────────────────────────────────────────

export interface AlgoInsight {
  generatedAt: string;
  sampleSize: number;
  stats: {
    byType: Array<{ type: string; avgImp: number; avgEng: number; count: number }>;
    byHour: Array<{ hour: number; avgImp: number; count: number }>;
    byDayOfWeek: Array<{ day: number; label: string; avgImp: number; count: number }>;
    correlations: { textLength: number; emojiCount: number; lineCount: number; hasQuestion: number; hasNumber: number };
    topPosts: Array<{ tweetId: string; postedAt: string; type: string; impressions: number; engScore: number }>;
    bottomPosts: Array<{ tweetId: string; postedAt: string; type: string; impressions: number; engScore: number }>;
  };
  discussion: {
    claudeHypothesis: string;
    o3Challenge: string;
    claudeSynthesis: string;
  };
  briefing: string;
}

interface AlgoInsightData {
  insights: AlgoInsight[];
}

let algoInsightCache: AlgoInsightData = { insights: [] };

function saveAlgoInsightAsync() {
  writeJson('algo-insights.json', algoInsightCache).catch((e: any) =>
    console.warn('  ⚠ algo-insights.json 保存失敗:', e.message),
  );
}

export function saveAlgoInsight(insight: AlgoInsight): void {
  algoInsightCache.insights.unshift(insight);
  if (algoInsightCache.insights.length > 12) algoInsightCache.insights = algoInsightCache.insights.slice(0, 12);
  saveAlgoInsightAsync();
}

export function getAlgoInsights(limit = 5): AlgoInsight[] {
  return algoInsightCache.insights.slice(0, limit);
}

export function getLatestAlgoInsight(): AlgoInsight | null {
  return algoInsightCache.insights[0] ?? null;
}

// ─── Rebrandly クリック数追跡 ──────────────────────────────────────────────

export interface RebrandlyLink {
  id: string;
  slashtag: string;
  destination: string;   // FANZAアフィリエイトURL
  title: string;
  clicks: number;
  lastSyncedAt: string;  // ISO timestamp
}

interface RebrandlyData {
  links: RebrandlyLink[];
  lastSyncedAt: string | null;
}

let rebrandlyCache: RebrandlyData = { links: [], lastSyncedAt: null };

function saveRebrandlyAsync() {
  writeJson('rebrandly.json', rebrandlyCache).catch((e: any) =>
    console.warn('  ⚠ rebrandly.json 保存失敗:', e.message),
  );
}

export function upsertRebrandlyLinks(links: RebrandlyLink[]): void {
  rebrandlyCache.links = links;
  rebrandlyCache.lastSyncedAt = new Date().toISOString();
  saveRebrandlyAsync();
}

export function getRebrandlyData(): RebrandlyData {
  return rebrandlyCache;
}

export function getRebrandlyTotalClicks(): number {
  return rebrandlyCache.links.reduce((s, l) => s + l.clicks, 0);
}

// サーバー再起動後もリセットされないようにGCSに永続化する

interface SchedulerStateData {
  celebPostedDate: string;  // "YYYY-MM-DD" in JST
}

let schedulerStateCache: SchedulerStateData = { celebPostedDate: '' };

function saveSchedulerStateAsync() {
  writeJson('scheduler-state.json', schedulerStateCache).catch((e: any) =>
    console.warn('  ⚠ scheduler-state.json 保存失敗:', e.message),
  );
}

export function getCelebPostedDate(): string {
  return schedulerStateCache.celebPostedDate;
}

export function setCelebPostedDate(date: string): void {
  schedulerStateCache.celebPostedDate = date;
  saveSchedulerStateAsync();
}

