export function pickCelebrity(): { name: string; hooks: string[] } {
  return { name: '', hooks: [] };
}

export function pickRandom(arr: string[]): string {
  return arr[Math.floor(Math.random() * arr.length)] ?? '';
}

export async function getCelebrityLikeItems(_mapping: any, _count: number): Promise<any[]> {
  return [];
}
