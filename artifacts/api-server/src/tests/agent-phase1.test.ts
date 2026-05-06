import { describe, it, expect, vi } from 'vitest';
import { calculateGrowthScore } from '../bot/growth-score.js';
import { runComplianceGuard, validateProposalSchema } from '../bot/compliance-guard.js';
import type { MarketPost } from '../bot/agent-types.js';

vi.mock('../bot/twitter.js', () => ({
  searchMarketTweetsPage: vi.fn(async (_query: string, _max: number, token?: string) => {
    if (!token) {
      return {
        tweets: [{
          id: '1',
          authorId: 'a1',
          username: '@one',
          text: 'FANZA レビューが強い投稿',
          like_count: 20,
          retweet_count: 3,
          reply_count: 2,
          bookmark_count: 1,
          impression_count: 1000,
          createdAt: new Date(Date.now() - 2 * 3600000).toISOString(),
          media_type: 'photo',
          has_url: false,
          possibly_sensitive: true,
          hashtags: ['FANZA'],
          author_followers_count: 1000,
        }],
        nextToken: 'next',
        errors: [],
      };
    }
    return {
      tweets: [{
        id: '2',
        authorId: 'a2',
        username: '@two',
        text: 'FANZA セール訴求',
        like_count: 5,
        retweet_count: 1,
        reply_count: 1,
        bookmark_count: 0,
        impression_count: 500,
        createdAt: new Date(Date.now() - 1 * 3600000).toISOString(),
        media_type: 'video',
        has_url: true,
        possibly_sensitive: true,
        hashtags: ['FANZA'],
        author_followers_count: 800,
      }],
      errors: [],
    };
  }),
  fetchUserTimelineMarketPage: vi.fn(async () => ({ tweets: [], errors: [] })),
}));

vi.mock('../bot/storage.js', () => ({
  getAllPosts: () => [],
  getRecentlyPostedIds: () => new Set<string>(),
}));

vi.mock('../bot/post-analytics.js', () => ({
  getAnalytics: () => [],
  getProductClickSignals: () => ({}),
  getClickedProductSignals: () => [],
}));

vi.mock('../bot/fanza.js', () => ({
  getRevenueOptimizedItems: vi.fn(async () => [{
    content_id: 'cid-1',
    title: 'レビューが強い人妻作品',
    affiliateURL: 'https://example.com/aff',
    date: new Date().toISOString(),
    prices: { price: '980円 セール' },
    review: { average: '4.7', count: 120 },
    iteminfo: { genre: [{ name: '人妻' }], actress: [{ name: 'テスト女優' }] },
    sampleImageURL: { sample_l: { image: ['https://example.com/sample.jpg'] } },
  }]),
  getSampleImages: (item: any) => item.sampleImageURL?.sample_l?.image ?? [],
  scoreFanzaItem: () => ({
    score: 6.2,
    qualityScore: 4.1,
    clickBoost: 0,
    detail: { review: 2, rating: 2, sale: 0.75, sample: 0.55, genre: 0.18, actress: 0.18, freshness: 0.35, affinity: 0 },
    reasons: ['レビュー120件', '高評価4.7', 'セール訴求向き', 'サンプル1枚'],
  }),
}));

vi.mock('../bot/agent-learning-store.js', () => ({
  getProposalFeedback: vi.fn(async () => []),
  recordProposalFeedback: vi.fn(async (feedback: any) => ({ id: 'fb', created_at: new Date().toISOString(), ...feedback })),
}));

describe('growth_score', () => {
  it('初速と反応率が高い投稿に理由を付ける', () => {
    const post: MarketPost = {
      post_id: 'p1',
      author_id: 'a1',
      username: '@test',
      text: 'FANZA レビュー訴求',
      created_at: new Date(Date.now() - 3 * 3600000).toISOString(),
      public_metrics: {
        like_count: 100,
        retweet_count: 20,
        reply_count: 10,
        quote_count: 3,
        bookmark_count: 5,
        impression_count: 2000,
      },
      media_type: 'video',
      has_url: false,
      possibly_sensitive: true,
      hashtags: ['FANZA'],
      collected_at: new Date().toISOString(),
      author_followers_count: 1500,
      source: '#FANZA',
    };
    const score = calculateGrowthScore(post);
    expect(score.score).toBeGreaterThan(0);
    expect(score.engagementRate).toBeGreaterThan(0.03);
    expect(score.reasons.join(' ')).toContain('初速');
  });
});

describe('X API pagination scan', () => {
  it('Recent SearchのnextTokenをたどって複数ページを収集する', async () => {
    const { scanMarket, normalizeAgentInput } = await import('../bot/agent-service.js');
    const input = normalizeAgentInput({ keywords: ['FANZA'], genres: [], accounts: [], maxResults: 50 });
    const result = await scanMarket(input);
    expect(result.posts.length).toBe(2);
    expect(result.posts[0].growth_score).toBeGreaterThanOrEqual(result.posts[1].growth_score);
  });
});

describe('ComplianceGuard', () => {
  it('PR表記を自動補完しcriticalなしなら許可する', () => {
    const result = runComplianceGuard('🔞レビューが強い作品です\n詳細はリプ欄へ', {
      isAffiliate: true,
      officialMaterialOnly: true,
      mediaRightsConfirmed: true,
    });
    expect(result.normalizedText).toContain('PR・広告');
    expect(result.allowed).toBe(true);
  });

  it('未成年関連をcriticalでブロックする', () => {
    const result = runComplianceGuard('PR｜JK作品です', { isAffiliate: true });
    expect(result.allowed).toBe(false);
    expect(result.risk_flags.some((f) => f.severity === 'critical')).toBe(true);
  });
});

describe('proposal JSON Schema', () => {
  it('必須フィールドが揃うproposalをvalidとみなす', () => {
    expect(validateProposalSchema({
      id: 'p',
      recommended_work_type: 'high-rated',
      recommended_genre: 'レビュー',
      draft_text: 'PR・広告｜🔞レビュー訴求',
      cta: '詳細はリプ欄へ',
      hashtags: ['PR'],
      media_format: 'image',
      recommended_post_time_jst: '20:00',
      avoid_patterns: [],
      reason: 'test',
      confidence: 0.7,
      expected_effect: 'CTR改善',
      attached_media: { format: 'image', source: 'official_fanza', reason: '公式素材' },
      risk_flags: [],
    })).toBe(true);
  });
});

describe('posting improvement logic', () => {
  it('競合投稿を勝ちパターンに分類する', async () => {
    const { classifyMarketPosts, summarizeWinningPatterns } = await import('../bot/posting-improvement.js');
    const posts = classifyMarketPosts([{
      post_id: 'm1',
      author_id: 'a',
      username: '@market',
      source: 'FANZA',
      text: 'ランキング上位の人妻セール作品、詳細はリプ欄へ',
      created_at: new Date().toISOString(),
      collected_at: new Date().toISOString(),
      public_metrics: { like_count: 20, retweet_count: 2, reply_count: 1, quote_count: 0, bookmark_count: 1, impression_count: 1000 },
      media_type: 'photo',
      has_url: false,
      possibly_sensitive: true,
      hashtags: ['FANZA'],
      growth_score: 120,
      growth_reason: ['画像付き投稿'],
      engagement_rate: 0.024,
      age_hours: 2,
    }]);
    expect(posts[0].pattern_types).toContain('sale_appeal');
    expect(posts[0].pattern_types).toContain('ranking_appeal');
    expect(summarizeWinningPatterns(posts)[0].avgGrowthScore).toBeGreaterThan(0);
  });

  it('market_scan出力に作品・媒体・時間・JSON Schemaを含める', async () => {
    const { normalizeAgentInput, runMarketAnalysis } = await import('../bot/agent-service.js');
    const run = await runMarketAnalysis(normalizeAgentInput({ keywords: ['FANZA'], genres: ['人妻'], accounts: [], maxResults: 50, proposalCount: 2 }), 'test');
    expect(run.status).toBe('completed');
    expect(run.output?.recommendedWorks.length).toBeGreaterThan(0);
    expect(run.output?.proposals[0].expected_effect).toBeTruthy();
    expect(run.output?.proposals[0].attached_media.format).toMatch(/image|video|none/);
    expect(run.output?.recommendationSchema.drafts.length).toBeGreaterThan(0);
  });
});
