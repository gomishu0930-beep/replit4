import type { DirectiveExecution, MeetingDirective } from './meeting.js';

export async function executeDirective(directive: MeetingDirective): Promise<DirectiveExecution> {
  console.log(`  ⚡ [executeDirective] "${directive?.text?.slice(0, 50) ?? 'unknown'}" — スタブ実行`);
  return {
    at: new Date().toISOString(),
    actionType: 'no-op',
    summary: 'スタブ: 自動実行は未実装です',
    changes: [],
    success: true,
  };
}
