export async function getBudgetBriefing(): Promise<string> {
  return '月額コスト: ¥25,799 (Replit ¥3,000 + Twitter API ¥15,000 + Rebrandly ¥4,350 + Canva ¥1,949 + OpenAI ¥1,500)';
}

export async function runBudgetReview() {
  return {
    estimate: { grandTotal: 25799 / 150, budgetStatus: '正常' },
  };
}
