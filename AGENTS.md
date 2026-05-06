# AGENTS.md

## Project Purpose

このリポジトリは、FANZAアフィリエイト運用を支援するAIエージェントシステムです。

主な目的は以下です。

- X市場分析
- 自アカウント投稿との比較
- FANZA/DMM作品分析
- 投稿文、画像、動画、CTA、投稿時間の改善提案
- Discordと既存Web UIからの共通操作
- 承認付き投稿・予約投稿
- 投稿後の成果フィードバックによる継続改善

## Current Migration Context

現在、一部の分析と投稿文生成はClaudeによって行われています。
しかし、分析が投稿改善に十分つながっておらず、UI上のClaudeエージェントも十分機能していません。

今後は、Claude固有実装に依存しすぎず、Codexを使って以下を進めます。

- 既存Claudeフローの原因分析
- AnalysisServiceの共通化
- DraftAgentの改善
- ComplianceGuardの強化
- Discordと既存UIの共通Agent API化
- 投稿後データを使った改善ループの実装

Claude関連コードを即削除してはいけません。
まずadapter化し、将来的にCodex/Claude/他モデル/ルールベースを切り替えられる構造にしてください。

## Important Product Constraints

このプロダクトは成人向けアフィリエイトを扱います。
そのため、以下を最優先してください。

- 未成年に関する性的表現、素材、示唆は必ずブロックする。
- 非同意、盗撮、権利不明、無断転載の疑いがある素材は必ずブロックする。
- 画像・動画はDMM/FANZA公式で利用可能な素材、または権利確認済み素材のみ使う。
- 投稿文には、PR、広告、アフィリエイトリンクを含むことが明確に分かる表記を入れる。
- 成人向けメディアはsensitive media前提で扱う。
- Xのスパム、重複投稿、プラットフォーム操作、大量自動投稿を助長する実装は禁止。
- 完全自動投稿ではなく、人間承認後のみ投稿または予約投稿する。
- 類似文面の連投を防ぐ。
- 投稿案には必ずreason、confidence、risk_flagsを付ける。

## Codex / OpenAI Usage Policy

ユーザーは、可能であればOpenAI APIを直接叩かずにCodex App / Codex App Server / Codex CLI / MCPを使いたいと考えています。

ただし、X投稿データやFANZA/DMM作品データの取得には、必要に応じて外部APIを使って構いません。

Codex App Serverが本番常駐エージェントとして不向きな場合は、無理に採用しないでください。
その場合は、Codexを開発・レビュー・改善・承認支援に使い、実運用はAgent API Server、Discord Bot、既存UI、Scheduler、DBで行う設計を提案してください。

## Desired Architecture

理想構成:

Discord Bot
→ Common Agent API Server
→ AnalysisService / DraftAgent / ComplianceGuard
→ XConnector / DmmFanzaConnector
→ PostgreSQL / Redis
→ Existing Web UI

既存UIとDiscordは、同じ分析ロジック、同じdraft、同じagent_runを参照すること。

## Core Services

可能な限り、以下の責務に分離してください。

- XConnector
  - X APIから投稿・アカウント・メトリクスを取得する。
  - 最大500件の取得に対応する。
  - rate limit、pagination、error handlingを行う。

- OwnPostService
  - 自分の投稿、impression、engagement、url_clicks、conversions、revenueを扱う。

- WorkAnalysisService
  - FANZA/DMM作品、ジャンル、メーカー、価格、セール、サンプル素材、成果を分析する。

- MarketAnalysisService
  - 競合投稿、伸びているアカウント、時間帯、メディア形式、訴求軸を分析する。

- DraftAgent
  - 投稿対象作品、投稿文、CTA、ハッシュタグ、画像/動画、投稿時間を提案する。

- ComplianceGuard
  - PR表記、成人向け、安全性、権利、重複、Xポリシーリスクを検査する。

- AgentRunService
  - すべての実行ログをrun_idで管理する。

## Output Requirements

AI分析・投稿提案は、可能な限りJSON Schemaで返してください。

最低限のフィールド:

```json
{
  "summary": "string",
  "recommended_works": [],
  "winning_patterns": [],
  "own_account_gaps": [],
  "drafts": [],
  "media_recommendations": [],
  "schedule_recommendations": [],
  "risk_flags": [],
  "confidence": 0.0,
  "reasons": []
}
```
