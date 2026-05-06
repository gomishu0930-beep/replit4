export type AgentRunStatus = 'running' | 'completed' | 'failed';
export type AgentRunKind = 'market_scan' | 'compare_own' | 'work_analysis' | 'draft' | 'report';
export type MediaType = 'none' | 'photo' | 'video' | 'animated_gif' | 'mixed' | 'unknown';
export type RiskSeverity = 'info' | 'warning' | 'critical';
export type MarketPatternType =
  | 'work_title_appeal'
  | 'actress_name_appeal'
  | 'genre_appeal'
  | 'sale_appeal'
  | 'ranking_appeal'
  | 'image_main'
  | 'video_main'
  | 'short_cta'
  | 'long_review'
  | 'thread_type'
  | 'profile_redirect';

export interface PublicMetrics {
  like_count: number;
  retweet_count: number;
  reply_count: number;
  quote_count?: number;
  bookmark_count?: number;
  impression_count?: number;
}

export interface MarketPost {
  post_id: string;
  author_id: string;
  username: string;
  text: string;
  created_at: string;
  public_metrics: PublicMetrics;
  media_type: MediaType;
  has_url: boolean;
  possibly_sensitive: boolean;
  hashtags: string[];
  collected_at: string;
  author_followers_count?: number;
  source: string;
}

export interface GrowthScoreConfig {
  likeWeight: number;
  repostWeight: number;
  replyWeight: number;
  quoteWeight: number;
  bookmarkWeight: number;
  halfLifeHours: number;
  followerScale: number;
  mediaBoost: Record<string, number>;
  urlPenalty: number;
  sensitivePenalty: number;
}

export interface GrowthScoreResult {
  score: number;
  rawEngagement: number;
  engagementRate: number;
  ageHours: number;
  reasons: string[];
}

export interface RankedMarketPost extends MarketPost {
  growth_score: number;
  growth_reason: string[];
  engagement_rate: number;
  age_hours: number;
}

export interface ClassifiedMarketPost extends RankedMarketPost {
  pattern_types: MarketPatternType[];
  appeal_axis: string;
  inferred_genre: string;
  classification_reason: string[];
}

export interface OwnPostComparison {
  postId: string;
  postedAt: string;
  category: string;
  textLength: number;
  mediaType: MediaType;
  hasUrl: boolean;
  genre: string;
  appealAxis: string;
  impressions: number;
  engagement: number;
  engagementRate: number;
  urlClicks: number;
  ctr: number;
  conversions: number;
  revenue: number;
  textPreview: string;
  patternTypes: MarketPatternType[];
}

export interface PatternSummary {
  pattern: MarketPatternType;
  label: string;
  count: number;
  avgGrowthScore: number;
  avgEngagementRate: number;
  marketShare: number;
  reason: string;
}

export interface OwnAccountGap {
  code: string;
  severity: RiskSeverity;
  axis: 'pattern' | 'revenue' | 'click' | 'exposure' | 'time' | 'media' | 'genre';
  message: string;
  recommended_action: string;
  evidence: string[];
}

export interface FanzaWorkCandidate {
  content_id: string;
  title: string;
  affiliate_url?: string;
  genres: string[];
  actresses: string[];
  release_date?: string;
  price?: string;
  is_sale: boolean;
  review_average: number;
  review_count: number;
  has_sample_images: boolean;
  has_sample_video: boolean;
  sample_image_urls: string[];
  sample_video_url?: string;
  rights_confirmed: boolean;
  score: number;
  score_detail: Record<string, number>;
  reasons: string[];
  matched_market_patterns: MarketPatternType[];
}

export interface MediaRecommendation {
  format: 'none' | 'image' | 'video';
  reason: string;
  confidence: number;
  risk_flags: RiskFlag[];
}

export interface ScheduleRecommendation {
  time_jst: string;
  reason: string;
  confidence: number;
}

export interface LearningSignal {
  code: string;
  message: string;
  evidence: string[];
  weight: number;
}

export interface MarketComparisonSummary {
  ownCount: number;
  competitorCount: number;
  avgOwnEngagementRate: number;
  avgMarketEngagementRate: number;
  avgOwnTextLength: number;
  avgMarketTextLength: number;
  bestMarketHours: Array<{ hour: number; avgGrowthScore: number; count: number }>;
  bestOwnHours: Array<{ hour: number; avgEngagementRate: number; count: number }>;
  mediaLift: Array<{ mediaType: MediaType; avgGrowthScore: number; count: number }>;
  urlComparison: {
    ownCtr: number;
    marketUrlShare: number;
  };
  gaps: string[];
  winningPatterns: PatternSummary[];
  ownAccountGaps: OwnAccountGap[];
}

export interface RiskFlag {
  code: string;
  severity: RiskSeverity;
  message: string;
}

export interface ComplianceDecision {
  allowed: boolean;
  normalizedText: string;
  risk_flags: RiskFlag[];
  sensitive_media: boolean;
}

export interface DraftProposal {
  id: string;
  work?: FanzaWorkCandidate;
  recommended_work_type: string;
  recommended_genre: string;
  draft_text: string;
  cta: string;
  hashtags: string[];
  media_format: 'none' | 'image' | 'video';
  attached_media: {
    format: 'none' | 'image' | 'video';
    source: 'official_fanza' | 'rights_confirmed' | 'none';
    reason: string;
    sample_url?: string;
  };
  recommended_post_time_jst: string;
  avoid_patterns: string[];
  reason: string;
  confidence: number;
  expected_effect: string;
  risk_flags: RiskFlag[];
  market_evidence: string[];
  compliance: ComplianceDecision;
}

export interface RecommendationSchemaOutput {
  summary: string;
  recommended_works: FanzaWorkCandidate[];
  winning_patterns: PatternSummary[];
  own_account_gaps: OwnAccountGap[];
  drafts: DraftProposal[];
  media_recommendations: MediaRecommendation[];
  schedule_recommendations: ScheduleRecommendation[];
  risk_flags: RiskFlag[];
  confidence: number;
  reasons: string[];
}

export interface ClaudeFlowDiagnostic {
  issues: Array<{ code: string; message: string; evidence: string }>;
  adapterStatus: {
    claudeConfigured: boolean;
    commonAnalysisService: boolean;
    adapters: Array<{ kind: string; enabled: boolean; reason: string; legacyEntryPoints?: string[] }>;
  };
}

export interface AgentRunInput {
  keywords: string[];
  genres: string[];
  accounts: string[];
  maxResults: number;
  ownDays: number;
  proposalCount: number;
}

export interface AgentRunOutput {
  marketPosts: RankedMarketPost[];
  classifiedMarketPosts: ClassifiedMarketPost[];
  ownPosts: OwnPostComparison[];
  comparison: MarketComparisonSummary;
  recommendedWorks: FanzaWorkCandidate[];
  proposals: DraftProposal[];
  mediaRecommendations: MediaRecommendation[];
  scheduleRecommendations: ScheduleRecommendation[];
  learningSignals: LearningSignal[];
  recommendationSchema: RecommendationSchemaOutput;
  diagnostics: ClaudeFlowDiagnostic;
}

export interface AgentRun {
  run_id: string;
  kind: AgentRunKind;
  status: AgentRunStatus;
  source: 'ui' | 'discord' | 'api' | 'test';
  input: AgentRunInput;
  output?: AgentRunOutput;
  started_at: string;
  finished_at?: string;
  error?: string;
  cost_estimate: number;
  data_count: number;
  risk_flags: RiskFlag[];
}
