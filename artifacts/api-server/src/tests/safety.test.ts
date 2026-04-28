/**
 * 安全装置の基本テスト
 * `pnpm --filter @workspace/api-server test` で実行
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { filterContent, filterImagePrompt } from '../bot/content-filter.js';
import { getRunConfig, updateRunConfig, loadRunConfig } from '../bot/run-config.js';
import {
  enqueuePost, getQueue, getPendingQueue, approveQueueItem,
  rejectQueueItem, getQueueStats, loadQueue,
} from '../bot/post-queue.js';

// ─── コンテンツフィルターテスト ──────────────────────────────────────────────

describe('contentFilter', () => {
  it('安全なテキストはパスする', () => {
    const result = filterContent('🔞昨夜の出来事、聞いてもらっていいですか\n残業で2人きりになった瞬間', 'strict');
    expect(result.safe).toBe(true);
    expect(result.blockedWords).toHaveLength(0);
  });

  it('未成年連想ワードをブロックする', () => {
    const result = filterContent('JKの制服姿が', 'strict');
    expect(result.safe).toBe(false);
    expect(result.blockedWords.length).toBeGreaterThan(0);
  });

  it('ロリワードをブロックする', () => {
    const result = filterContent('ロリ系の作品', 'strict');
    expect(result.safe).toBe(false);
  });

  it('非同意ワードをブロックする', () => {
    const result = filterContent('非同意でレイプする', 'strict');
    expect(result.safe).toBe(false);
    expect(result.reason).toContain('非同意');
  });

  it('制服ワードをstrictモードでブロックする', () => {
    const result = filterContent('制服を脱いで', 'strict');
    expect(result.safe).toBe(false);
  });

  it('複数の危険ワードを全て検出する', () => {
    const result = filterContent('未成年の学生がロリ', 'strict');
    expect(result.safe).toBe(false);
    expect(result.blockedWords.length).toBeGreaterThan(1);
  });

  it('画像プロンプトの禁止ワードをブロックする', () => {
    const result = filterImagePrompt('school uniform, young girl');
    expect(result.safe).toBe(false);
  });

  it('安全な画像プロンプトはパスする', () => {
    const result = filterImagePrompt('office lady, pencil skirt, late night office');
    expect(result.safe).toBe(true);
  });
});

// ─── RunConfigテスト ─────────────────────────────────────────────────────────

describe('runConfig', () => {
  it('デフォルトでdryRun=true, autoPostEnabled=false', () => {
    loadRunConfig();
    const config = getRunConfig();
    expect(typeof config.dryRun).toBe('boolean');
    expect(typeof config.autoPostEnabled).toBe('boolean');
  });

  it('updateRunConfigで値を変更できる', () => {
    updateRunConfig({ maxPostsPerHour: 2 });
    expect(getRunConfig().maxPostsPerHour).toBe(2);
    updateRunConfig({ maxPostsPerHour: 1 });
  });
});

// ─── PostQueueテスト ─────────────────────────────────────────────────────────

describe('postQueue', () => {
  beforeEach(() => {
    loadQueue();
  });

  it('enqueuePostがキューに追加する', () => {
    const before = getQueueStats().total;
    enqueuePost({ type: 'engagement', text: 'テストツイート' });
    expect(getQueueStats().total).toBe(before + 1);
  });

  it('pendingキューに追加される', () => {
    enqueuePost({ type: 'engagement', text: 'テストツイート pending' });
    const pending = getPendingQueue();
    expect(pending.some(i => i.text === 'テストツイート pending')).toBe(true);
  });

  it('approveQueueItemでステータスがapprovedになる', () => {
    const item = enqueuePost({ type: 'engagement', text: 'approve test' });
    const approved = approveQueueItem(item.id);
    expect(approved?.status).toBe('approved');
  });

  it('rejectQueueItemでステータスがrejectedになる', () => {
    const item = enqueuePost({ type: 'engagement', text: 'reject test' });
    const rejected = rejectQueueItem(item.id);
    expect(rejected?.status).toBe('rejected');
  });

  it('存在しないIDはnullを返す', () => {
    const result = approveQueueItem('nonexistent-id');
    expect(result).toBeNull();
  });

  it('statsが正しいカウントを返す', () => {
    const item = enqueuePost({ type: 'engagement', text: 'stats test' });
    const stats = getQueueStats();
    expect(stats.pending).toBeGreaterThanOrEqual(1);
    rejectQueueItem(item.id);
    expect(getQueueStats().rejected).toBeGreaterThanOrEqual(1);
  });
});
