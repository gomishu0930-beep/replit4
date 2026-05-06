import type { AgentRunInput, MarketPost, RankedMarketPost, RiskFlag } from './agent-types.js';
import { calculateGrowthScore } from './growth-score.js';
import { fetchUserTimelineMarketPage, searchMarketTweetsPage } from './twitter.js';

function extractHashtags(text: string): string[] {
  return [...text.matchAll(/#([\p{L}\p{N}_]+)/gu)].map((m) => m[1]).slice(0, 10);
}

function toMarketPost(raw: any, source: string): MarketPost {
  const text = raw.text ?? '';
  return {
    post_id: raw.id,
    author_id: raw.authorId ?? raw.author_id ?? '',
    username: raw.username ?? '',
    text,
    created_at: raw.createdAt ?? raw.created_at ?? new Date().toISOString(),
    public_metrics: {
      like_count: raw.like_count ?? raw.public_metrics?.like_count ?? 0,
      retweet_count: raw.retweet_count ?? raw.public_metrics?.retweet_count ?? 0,
      reply_count: raw.reply_count ?? raw.public_metrics?.reply_count ?? 0,
      quote_count: raw.quote_count ?? raw.public_metrics?.quote_count ?? 0,
      bookmark_count: raw.bookmark_count ?? raw.public_metrics?.bookmark_count ?? 0,
      impression_count: raw.impression_count ?? raw.public_metrics?.impression_count ?? 0,
    },
    media_type: raw.media_type ?? 'none',
    has_url: Boolean(raw.has_url ?? /https?:\/\/\S+/i.test(text)),
    possibly_sensitive: Boolean(raw.possibly_sensitive),
    hashtags: raw.hashtags ?? extractHashtags(text),
    collected_at: new Date().toISOString(),
    author_followers_count: raw.author_followers_count,
    source,
  };
}

export async function scanMarketPosts(input: AgentRunInput): Promise<{ posts: RankedMarketPost[]; risks: RiskFlag[]; errors: string[] }> {
  const dedup = new Map<string, MarketPost>();
  const errors: string[] = [];
  const risks: RiskFlag[] = [];
  const queries = [...input.keywords, ...input.genres.map((g) => `FANZA ${g}`)]
    .filter(Boolean)
    .slice(0, 16);
  const perSourceLimit = Math.max(20, Math.ceil(input.maxResults / Math.max(queries.length + input.accounts.length, 1)));

  for (const query of queries) {
    let nextToken: string | undefined;
    let fetchedForQuery = 0;
    for (let page = 0; page < 6 && dedup.size < input.maxResults && fetchedForQuery < perSourceLimit; page++) {
      const pageResult = await searchMarketTweetsPage(query, Math.min(100, perSourceLimit - fetchedForQuery), nextToken);
      errors.push(...pageResult.errors);
      for (const raw of pageResult.tweets) {
        const post = toMarketPost(raw, query);
        dedup.set(post.post_id, post);
      }
      fetchedForQuery += pageResult.tweets.length;
      nextToken = pageResult.nextToken;
      if (!nextToken || pageResult.tweets.length === 0) break;
    }
  }

  for (const account of input.accounts) {
    let nextToken: string | undefined;
    let fetchedForAccount = 0;
    for (let page = 0; page < 6 && dedup.size < input.maxResults && fetchedForAccount < perSourceLimit; page++) {
      const pageResult = await fetchUserTimelineMarketPage(account, Math.min(100, perSourceLimit - fetchedForAccount), nextToken);
      errors.push(...pageResult.errors);
      for (const raw of pageResult.tweets) {
        const post = toMarketPost(raw, `@${account}`);
        dedup.set(post.post_id, post);
      }
      fetchedForAccount += pageResult.tweets.length;
      nextToken = pageResult.nextToken;
      if (!nextToken || pageResult.tweets.length === 0) break;
    }
  }

  if (dedup.size < Math.min(input.maxResults, 50)) {
    risks.push({
      code: 'market_data_underfilled',
      severity: 'warning',
      message: `市場投稿の取得数が少なめです (${dedup.size}/${input.maxResults})。X API権限、検索プラン、TRACK_ACCOUNTSを確認してください`,
    });
  }
  for (const error of errors.slice(0, 5)) {
    risks.push({ code: 'x_api_collection_error', severity: 'warning', message: error });
  }

  const posts = [...dedup.values()]
    .map((post) => {
      const score = calculateGrowthScore(post);
      return {
        ...post,
        growth_score: score.score,
        growth_reason: score.reasons,
        engagement_rate: score.engagementRate,
        age_hours: score.ageHours,
      };
    })
    .sort((a, b) => b.growth_score - a.growth_score)
    .slice(0, input.maxResults);

  return { posts, risks, errors };
}
