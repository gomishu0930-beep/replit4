export async function executeDirective(directive: any): Promise<{ success: boolean; result: string }> {
  console.log(`  ⚡ [executeDirective] "${directive?.text?.slice(0, 50) ?? 'unknown'}" — スタブ実行`);
  return { success: true, result: 'スタブ: 自動実行は未実装です' };
}
