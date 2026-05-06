/**
 * コンテンツ安全フィルター
 * 危険ワード検出・投稿テキストの安全性チェックを行う。
 * - 未成年・未成年を直接示すワード
 * - 非同意・強制・盗撮ワード
 * - 特定人物に似せる表現
 * をブロックする。
 */

export interface FilterResult {
  safe: boolean;
  reason?: string;
  blockedWords: string[];
}

const MINORS_WORDS = [
  '未成年', '未成熟', '中学', '小学', '高校生', 'JK', 'JS', 'JC',
  'ランドセル', '幼い', '少女', '幼女',
  '子供', 'こども', '女子高', '女子中', '女子小', '10代', '10歳', '11歳',
  '12歳', '13歳', '14歳', '15歳', '16歳', '17歳', 'ロリ', 'ろり',
  'ペド', 'loli', 'lolita', 'underage', 'teen', 'minor',
];

const ADULT_CONTEXT_WORDS = [
  '成人', '大人', '20歳', '20代', '30代', '社会人', 'OL', '人妻', '熟女',
  'コスプレ', '成人向け', 'FANZA', 'AV', '女優',
];

const ADULT_ALLOWED_WORDS = [
  'JD', '制服', '学生服', 'スクール',
];

const NONCONSENT_WORDS = [
  '非同意', '強制', '無理やり', '無理矢理', '強姦', 'レイプ', '犯す',
  '盗撮', '隠し撮り', '覗き', '盗み撮り', '不法', '違法',
  'rape', 'non-consent', 'forced', 'voyeur', 'hidden camera',
];

const REAL_PERSON_WORDS = [
  '芸能人', '有名人',
  '〇〇似', '似てる', '似せた',
];

const DRUG_VIOLENCE_WORDS = [
  '薬物', '睡眠薬', '眠り薬', '精神薬', 'ドラッグ', '媚薬', '催眠',
  '暴行', '拷問', '虐待', '殺す', '死ね',
];

const ALL_FORBIDDEN = [
  ...MINORS_WORDS,
  ...NONCONSENT_WORDS,
  ...DRUG_VIOLENCE_WORDS,
];

const STRICT_FORBIDDEN = [
  ...ALL_FORBIDDEN,
  ...REAL_PERSON_WORDS,
];

export type FilterStrictness = 'normal' | 'strict' | 'relaxed';

export function filterContent(text: string, strictness: FilterStrictness = 'strict'): FilterResult {
  const wordList = strictness === 'relaxed' ? ALL_FORBIDDEN : STRICT_FORBIDDEN;
  const lower = text.toLowerCase();
  const blocked: string[] = [];
  const hasAdultContext = ADULT_CONTEXT_WORDS.some(w => lower.includes(w.toLowerCase()));

  for (const word of wordList) {
    if (lower.includes(word.toLowerCase())) {
      blocked.push(word);
    }
  }
  for (const word of ADULT_ALLOWED_WORDS) {
    if (lower.includes(word.toLowerCase()) && !hasAdultContext) {
      blocked.push(word);
    }
  }

  if (blocked.length === 0) return { safe: true, blockedWords: [] };

  const firstBlock = blocked[0];
  let reason = `禁止ワードを検出: 「${firstBlock}」`;
  if (MINORS_WORDS.some(w => w.toLowerCase() === firstBlock.toLowerCase())) {
    reason = `未成年連想ワードを検出: 「${firstBlock}」`;
  } else if (NONCONSENT_WORDS.some(w => w.toLowerCase() === firstBlock.toLowerCase())) {
    reason = `非同意/強制ワードを検出: 「${firstBlock}」`;
  } else if (REAL_PERSON_WORDS.some(w => w.toLowerCase() === firstBlock.toLowerCase())) {
    reason = `実在人物連想ワードを検出: 「${firstBlock}」`;
  }

  console.warn(`  🚫 [ContentFilter] ブロック: ${reason} (テキスト先頭: ${text.slice(0, 30)}...)`);

  return { safe: false, reason, blockedWords: blocked };
}

export function filterImagePrompt(prompt: string): FilterResult {
  const extraForbidden = [
    'school uniform', 'schoolgirl', 'student uniform', 'teenager', 'child',
    'young girl', 'little', 'small girl', 'minor', 'underage',
    ...MINORS_WORDS,
    ...NONCONSENT_WORDS,
  ];
  const lower = prompt.toLowerCase();
  const blocked: string[] = [];
  for (const word of extraForbidden) {
    if (lower.includes(word.toLowerCase())) blocked.push(word);
  }
  if (blocked.length === 0) return { safe: true, blockedWords: [] };
  const reason = `画像プロンプトに禁止ワード: 「${blocked[0]}」`;
  console.warn(`  🚫 [ContentFilter] 画像プロンプトブロック: ${reason}`);
  return { safe: false, reason, blockedWords: blocked };
}
