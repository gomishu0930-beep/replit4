import type { AgentRunInput, AgentRunOutput, RiskFlag } from './agent-types.js';

export type AnalysisAdapterKind = 'rule_based' | 'claude' | 'codex';

export interface AnalysisAdapterStatus {
  kind: AnalysisAdapterKind;
  enabled: boolean;
  reason: string;
  legacyEntryPoints?: string[];
}

export interface AnalysisAdapter {
  kind: AnalysisAdapterKind;
  status(): AnalysisAdapterStatus;
  analyze(input: AgentRunInput, output: AgentRunOutput): Promise<{ summary: string; risk_flags: RiskFlag[] }>;
}

class RuleBasedAnalysisAdapter implements AnalysisAdapter {
  kind: AnalysisAdapterKind = 'rule_based';

  status(): AnalysisAdapterStatus {
    return {
      kind: this.kind,
      enabled: true,
      reason: 'Phase 1の既定分析。X市場スキャン、growth_score、自投稿比較、ComplianceGuardを外部LLMなしで実行します',
    };
  }

  async analyze(_input: AgentRunInput, output: AgentRunOutput): Promise<{ summary: string; risk_flags: RiskFlag[] }> {
    const top = output.marketPosts[0];
    return {
      summary: top
        ? `市場上位は${top.media_type}型、growth_score=${top.growth_score}。提案数=${output.proposals.length}`
        : '市場データ不足のため、既存投稿実績と安全ルール中心で提案しました',
      risk_flags: output.proposals.flatMap((proposal) => proposal.risk_flags),
    };
  }
}

class ClaudeAnalysisAdapter implements AnalysisAdapter {
  kind: AnalysisAdapterKind = 'claude';

  status(): AnalysisAdapterStatus {
    const configured = Boolean(process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY && process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL);
    return {
      kind: this.kind,
      enabled: configured,
      reason: configured
        ? '既存Claude実装は残存。Phase 1では共通AnalysisAdapter境界から状態診断し、生成本線はrule_basedを使用します'
        : 'AI_INTEGRATIONS_ANTHROPIC_API_KEY / AI_INTEGRATIONS_ANTHROPIC_BASE_URL が未設定です',
      legacyEntryPoints: [
        'bot/discord-bot.ts: mention resident Claude agent',
        'bot/meeting.ts: Claude meeting flow',
        'bot/weekly-review.ts: weekly AI review',
        'routes/meeting.ts: UI meeting endpoints',
        'bot/scheduler.ts: FANZA generation path still template-first',
      ],
    };
  }

  async analyze(_input: AgentRunInput, _output: AgentRunOutput): Promise<{ summary: string; risk_flags: RiskFlag[] }> {
    return {
      summary: 'Claude adapter is diagnostic-only in Phase 1. Enable explicit provider routing before using it for production drafts.',
      risk_flags: [],
    };
  }
}

class CodexAnalysisAdapter implements AnalysisAdapter {
  kind: AnalysisAdapterKind = 'codex';

  status(): AnalysisAdapterStatus {
    return {
      kind: this.kind,
      enabled: false,
      reason: 'Codex App/CLI/MCPはPhase 1では開発・レビュー・承認支援向け。常駐本番実行はAgent API経由に寄せる想定です',
    };
  }

  async analyze(_input: AgentRunInput, _output: AgentRunOutput): Promise<{ summary: string; risk_flags: RiskFlag[] }> {
    return {
      summary: 'Codex adapter is not used for unattended production execution in Phase 1.',
      risk_flags: [],
    };
  }
}

export function getAnalysisAdapters(): AnalysisAdapter[] {
  return [
    new RuleBasedAnalysisAdapter(),
    new ClaudeAnalysisAdapter(),
    new CodexAnalysisAdapter(),
  ];
}

export function getAnalysisAdapterStatus(): AnalysisAdapterStatus[] {
  return getAnalysisAdapters().map((adapter) => adapter.status());
}
