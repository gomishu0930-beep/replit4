const noop = async (..._args: any[]) => {};

export const contact = new Proxy({} as Record<string, (...args: any[]) => Promise<void>>, {
  get: (_target, prop: string) => {
    return async (...args: any[]) => {
      console.log(`  📨 [contact.${prop}] 通知スキップ (スタブ)`);
    };
  },
});

export async function sendMeetingFullLog(_data: any): Promise<void> {
  console.log('  📨 [sendMeetingFullLog] スキップ (スタブ)');
}
