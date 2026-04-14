/**
 * 猥談投稿会議 継続スクリプト（R2〜R5）→ 画像生成 → X投稿
 * Usage: node continue-meeting.mjs
 */

const API = 'http://localhost:8080';
const SESSION_ID = 'meeting-1775894258369';
const AGENDA = '猥談×思い出語り投稿を作成してください。\n\n【最終ラウンド（R5）で必ず以下の形式で成果物を明示すること】\n【メインツイート】ここに本文（140字以内・具体的エピソード・えっちな表現OK）\n【リプライ1】ここに本文（140字以内・続き）\n【リプライ2】ここに本文（140字以内・FANZA作品URL誘導で締め）\n【画像プロンプト（英語）】ここにプロンプト（フォトリアリスティック・アイドル的可愛さ: baby face, round chubby cheeks, small cute button nose, large round sparkling eyes with aegyo sal, see-through bangs, dark brown hair・情緒的・アニメNG）\n\nトーン: 大人の男性が昔の甘酸っぱい体験を懐かしく振り返るスタイル。ハッシュタグなし。';

async function apiPost(path, body) {
  const r = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await r.json();
  if (!r.ok) throw new Error(`POST ${path} failed: ${json.error ?? r.status}`);
  return json;
}

async function getSession() {
  const r = await fetch(`${API}/api/bot/meeting/sessions/${SESSION_ID}`);
  return r.json();
}

function extractMsg(messages, speaker) {
  return [...messages].reverse().find(m => m.speaker === speaker)?.content ?? '';
}

function parseContent(allMessages) {
  // Claudeの最終発言から成果物抽出
  const claudeMsgs = allMessages.filter(m => m.speaker === 'claude');
  const gptMsgs    = allMessages.filter(m => m.speaker === 'gpt');
  const lastClaude = claudeMsgs[claudeMsgs.length - 1]?.content ?? '';
  const lastGpt    = gptMsgs[gptMsgs.length - 1]?.content ?? '';

  // メインソース: Claude、フォールバック: GPT
  const sources = [lastClaude, lastGpt];

  let tweet = '', reply1 = '', reply2 = '', imgPrompt = '';
  for (const src of sources) {
    tweet     = tweet     || src.match(/【メインツイート】\s*([\s\S]*?)(?=【|\n\n|$)/)?.[1]?.trim().replace(/^[「『]|[」』]$/g,'') || '';
    reply1    = reply1    || src.match(/【リプライ1】\s*([\s\S]*?)(?=【|\n\n|$)/)?.[1]?.trim().replace(/^[「『]|[」』]$/g,'') || '';
    reply2    = reply2    || src.match(/【リプライ2】\s*([\s\S]*?)(?=【|\n\n|$)/)?.[1]?.trim().replace(/^[「『]|[」』]$/g,'') || '';
    imgPrompt = imgPrompt || src.match(/【画像プロンプト[^】]*】\s*([\s\S]*?)(?=【|\n\n|$)/)?.[1]?.trim() || '';
  }

  return { tweet, reply1, reply2, imgPrompt, rawClaude: lastClaude };
}

// ─── メイン ──────────────────────────────────────────────────────────────────

console.log('\n🚀 会議継続フロー開始 (R2〜R5)');
console.log(`   Session: ${SESSION_ID}`);

// 1. 現在のセッション状態を取得
const session = await getSession();
const existingMessages = session.messages ?? [];
console.log(`\n📋 現在のメッセージ数: ${existingMessages.length}件`);
existingMessages.forEach((m, i) => console.log(`  [${i}] ${m.speaker}: ${m.content?.slice(0,60)}...`));

// 最後のGPT/Claude/Grokメッセージを取得（ラウンド間文脈）
let lastGpt    = extractMsg(existingMessages, 'gpt');
let lastClaude = extractMsg(existingMessages, 'claude');
let lastGrok   = extractMsg(existingMessages, 'grok');
let cumScores  = { gpt: 0, claude: 0 };
const allMessages = [...existingMessages];

// 既にR1が完了しているので R2〜5を実行
const startRound = Math.floor(existingMessages.filter(m => m.speaker === 'gpt').length) + 1;
console.log(`\n▶ ラウンド${startRound}から開始`);

for (let round = startRound; round <= 5; round++) {
  console.log(`\n  🔄 ラウンド ${round}/5 開始...`);
  const t0 = Date.now();

  try {
    const result = await apiPost(
      `/api/bot/meeting/sessions/${SESSION_ID}/trialogue`,
      {
        message: AGENDA,
        round,
        lastGptReply:    lastGpt.slice(0, 800),
        lastClaudeReply: lastClaude.slice(0, 800),
        lastGrokReply:   lastGrok.slice(0, 500),
        cumulativeScores: cumScores,
      }
    );

    const msgs = result.messages ?? [];
    allMessages.push(...msgs);

    lastGpt    = extractMsg(msgs, 'gpt')    || lastGpt;
    lastClaude = extractMsg(msgs, 'claude') || lastClaude;
    lastGrok   = extractMsg(msgs, 'grok')   || lastGrok;
    cumScores  = result.cumulativeScores ?? cumScores;

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`  ✅ R${round}完了 (${elapsed}s) | GPT=${lastGpt.length}字 Claude=${lastClaude.length}字`);
    console.log(`  📊 累積スコア: GPT=${cumScores.gpt} Claude=${cumScores.claude}`);

    if (result.isLastRound) {
      console.log('\n  🏁 最終ラウンド完了！');
      break;
    }
  } catch (e) {
    console.error(`  ❌ R${round}エラー:`, e.message);
    if (round <= 3) throw e; // 序盤エラーは中断
    console.warn('  ⚠ 残りのラウンドをスキップして結果抽出へ');
    break;
  }
}

// 2. 成果物を抽出
console.log('\n📋 成果物を抽出中...');
const content = parseContent(allMessages);

console.log('\n=== 抽出結果 ===');
console.log('【メインツイート】', content.tweet || '（抽出失敗）');
console.log('【リプライ1】', content.reply1 || '（抽出失敗）');
console.log('【リプライ2】', content.reply2 || '（抽出失敗）');
console.log('【画像プロンプト】', content.imgPrompt || '（抽出失敗）');
console.log('\n--- Claude最終発言 ---');
console.log(content.rawClaude);

if (!content.tweet || content.tweet.length < 5) {
  console.error('\n❌ メインツイートが抽出できませんでした。上のClaude最終発言を確認してください。');
  process.exit(1);
}

// 3. 画像生成（nanobanana2）
let imageUrl = null;
const imgPromptToUse = content.imgPrompt ||
  'cute japanese idol girl, baby face, round chubby cheeks, small cute button nose, large round sparkling eyes with aegyo sal, gentle smile, see-through bangs, dark brown hair, nostalgic summer evening, soft warm lighting, melancholic mood, reminiscing memories, cinematic portrait, photorealistic, 8K, no anime, no cartoon';

console.log('\n🍌 Nanobanana2で画像生成中...');
console.log('プロンプト:', imgPromptToUse.slice(0, 120));
try {
  const imgRes = await apiPost('/api/bot/nanobanana/generate', { prompt: imgPromptToUse });
  imageUrl = imgRes.imageUrl;
  console.log('✅ 画像生成完了:', imageUrl?.slice(0, 80));
} catch (e) {
  console.warn('⚠ 画像生成失敗（テキストのみで投稿）:', e.message);
}

// 4. 画像アップロード
let mediaIds = [];
if (imageUrl) {
  console.log('\n📤 画像をXにアップロード中...');
  try {
    const upRes = await apiPost('/api/bot/nanobanana/upload', { imageUrl });
    if (upRes.mediaId) {
      mediaIds = [upRes.mediaId];
      console.log('✅ アップロード完了 mediaId:', upRes.mediaId);
    }
  } catch (e) {
    console.warn('⚠ アップロード失敗（テキストのみ）:', e.message);
  }
}

// 5. メインツイート投稿
console.log('\n🐦 メインツイート投稿中...');
console.log('本文:', content.tweet);
const mainRes = await apiPost('/api/bot/tweet', { text: content.tweet, mediaIds });
const mainTweetId = mainRes.tweetId;
console.log('✅ メインツイート投稿完了:', mainTweetId);

// 少し待機
await new Promise(r => setTimeout(r, 3000));

// 6. リプライ1投稿
console.log('\n💬 リプライ1投稿中...');
console.log('本文:', content.reply1);
const r1Res = await apiPost('/api/bot/reply', { tweetId: mainTweetId, text: content.reply1 });
const reply1Id = r1Res.tweetId;
console.log('✅ リプライ1投稿完了:', reply1Id);

await new Promise(r => setTimeout(r, 3000));

// 7. リプライ2投稿
console.log('\n💬 リプライ2投稿中...');
console.log('本文:', content.reply2);
const r2Res = await apiPost('/api/bot/reply', { tweetId: reply1Id, text: content.reply2 });
const reply2Id = r2Res.tweetId;
console.log('✅ リプライ2投稿完了:', reply2Id);

console.log('\n✅✅✅ 全投稿完了！✅✅✅');
console.log({
  mainTweetId,
  reply1Id,
  reply2Id,
  imageUrl,
  tweetText: content.tweet,
  reply1Text: content.reply1,
  reply2Text: content.reply2,
});
