/**
 * 猥談×思い出語り投稿 — 会議→画像生成→投稿 自動フロー
 */

const API = 'http://localhost:8080';
const AGENDA = '猥談×思い出語り投稿を作成してください。\n\n【必須成果物（最終ラウンドで必ず明示すること）】\n①【メインツイート】〜140字以内\n②【リプライ1】〜140字以内（続き）\n③【リプライ2】〜140字以内（FANZA作品への誘導で締め）\n④【画像プロンプト（英語）】nanobanana2用・冒頭に"RAW photo"必須・フォトリアリスティック・アイドル的可愛さ(baby face, round chubby cheeks, small cute button nose, large round sparkling eyes with aegyo sal, see-through bangs, dark brown hair, natural skin texture with visible pores, fine peach fuzz, subsurface scattering on ear tips, tiny beauty mark near jawline, natural stray hair wisps)・末尾に"shot on Sony A7IV 85mm f/1.4, volumetric haze, film grain, 8K"必須・情緒的・アニメNG・CGI NG・plastic skin NG\n\n投稿トーン: 大人の男性が昔の甘酸っぱいえっちな体験を懐かしく語るスタイル。具体的エピソード風。ハッシュタグなし。';

async function post(path, body) {
  const r = await fetch(`${API}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json();
}

async function get(path) {
  const r = await fetch(`${API}${path}`);
  return r.json();
}

function extractMsg(messages, speaker) {
  return [...messages].reverse().find(m => m.speaker === speaker)?.content ?? '';
}

async function runMeeting(sessionId) {
  let lastGpt = '', lastClaude = '', lastGrok = '';
  let cumScores = { gpt: 0, claude: 0 };
  let allMessages = [];

  for (let round = 1; round <= 5; round++) {
    console.log(`\n  🔄 ラウンド ${round}/5 開始...`);
    const result = await post(
      `/api/bot/meeting/sessions/${sessionId}/trialogue`,
      { message: AGENDA, round, lastGptReply: lastGpt, lastClaudeReply: lastClaude, lastGrokReply: lastGrok, cumulativeScores: cumScores }
    );

    if (result.error) throw new Error(`ラウンド${round}エラー: ${result.error}`);

    const msgs = result.messages ?? [];
    allMessages.push(...msgs);
    lastGpt    = extractMsg(msgs, 'gpt');
    lastClaude = extractMsg(msgs, 'claude');
    lastGrok   = extractMsg(msgs, 'grok');
    cumScores  = result.cumulativeScores ?? cumScores;

    console.log(`  ✅ R${round}完了 | GPT=${lastGpt.length}字 Claude=${lastClaude.length}字 Grok=${lastGrok.length}字`);
    console.log(`  📊 累積スコア: GPT=${cumScores.gpt} Claude=${cumScores.claude}`);

    if (result.isLastRound) {
      console.log('\n  🏁 最終ラウンド完了！');
      break;
    }
  }
  return allMessages;
}

function parseContent(messages) {
  // Claudeの最後の発言から成果物を抽出
  const claudeMsgs = messages.filter(m => m.speaker === 'claude');
  const lastClaude = claudeMsgs[claudeMsgs.length - 1]?.content ?? '';

  const tweet     = lastClaude.match(/【メインツイート】\s*([\s\S]*?)(?=【|$)/)?.[1]?.trim() ?? '';
  const reply1    = lastClaude.match(/【リプライ1】\s*([\s\S]*?)(?=【|$)/)?.[1]?.trim() ?? '';
  const reply2    = lastClaude.match(/【リプライ2】\s*([\s\S]*?)(?=【|$)/)?.[1]?.trim() ?? '';
  const imgPrompt = lastClaude.match(/【画像プロンプト.*?】\s*([\s\S]*?)(?=【|$)/)?.[1]?.trim() ?? '';

  // フォールバック: GPTからも試みる
  if (!tweet || !imgPrompt) {
    const gptMsgs = messages.filter(m => m.speaker === 'gpt');
    const lastGpt = gptMsgs[gptMsgs.length - 1]?.content ?? '';
    return {
      tweet:     tweet  || lastGpt.match(/【メインツイート】\s*([\s\S]*?)(?=【|$)/)?.[1]?.trim() || '',
      reply1:    reply1 || lastGpt.match(/【リプライ1】\s*([\s\S]*?)(?=【|$)/)?.[1]?.trim() || '',
      reply2:    reply2 || lastGpt.match(/【リプライ2】\s*([\s\S]*?)(?=【|$)/)?.[1]?.trim() || '',
      imgPrompt: imgPrompt || lastGpt.match(/【画像プロンプト.*?】\s*([\s\S]*?)(?=【|$)/)?.[1]?.trim() || '',
      rawClaude: lastClaude,
    };
  }
  return { tweet, reply1, reply2, imgPrompt, rawClaude: lastClaude };
}

async function generateImage(prompt) {
  console.log('\n  🍌 Nanobanana2で画像生成中...');
  console.log('  プロンプト:', prompt.slice(0, 100));
  const r = await post('/api/bot/nanobanana/generate', { prompt });
  if (r.error) throw new Error('画像生成エラー: ' + r.error);
  return r.imageUrl ?? r.url ?? null;
}

async function postTweets(tweet, reply1, reply2, imageUrl) {
  console.log('\n  🐦 ツイート投稿中...');

  // 画像アップロード
  let mediaIds = [];
  if (imageUrl) {
    const uploaded = await post('/api/bot/nanobanana/upload', { imageUrl });
    if (uploaded.mediaId) {
      mediaIds = [uploaded.mediaId];
      console.log('  ✅ 画像アップロード完了 mediaId:', uploaded.mediaId);
    }
  }

  // メインツイート
  const main = await post('/api/bot/tweet', { text: tweet, mediaIds });
  if (!main.tweetId) throw new Error('メインツイート失敗: ' + JSON.stringify(main));
  console.log('  ✅ メインツイート投稿:', main.tweetId);

  // リプライ1
  await new Promise(r => setTimeout(r, 2000));
  const r1 = await post('/api/bot/reply', { tweetId: main.tweetId, text: reply1 });
  if (!r1.tweetId) throw new Error('リプライ1失敗: ' + JSON.stringify(r1));
  console.log('  ✅ リプライ1投稿:', r1.tweetId);

  // リプライ2
  await new Promise(r => setTimeout(r, 2000));
  const r2 = await post('/api/bot/reply', { tweetId: r1.tweetId, text: reply2 });
  if (!r2.tweetId) throw new Error('リプライ2失敗: ' + JSON.stringify(r2));
  console.log('  ✅ リプライ2投稿:', r2.tweetId);

  return { mainId: main.tweetId, reply1Id: r1.tweetId, reply2Id: r2.tweetId };
}

// ─── main ────────────────────────────────────────────────────────────────────

const [,, sessionId, researchId] = process.argv;
if (!sessionId) { console.error('Usage: node run-meeting-post.mjs <sessionId> [researchId]'); process.exit(1); }

console.log(`\n🚀 会議開始 sessionId=${sessionId}`);

try {
  // 1. 会議実行
  const messages = await runMeeting(sessionId);

  // 2. 成果物抽出
  console.log('\n📋 成果物を抽出中...');
  const content = parseContent(messages);

  console.log('\n=== 抽出結果 ===');
  console.log('【メインツイート】', content.tweet.slice(0, 200));
  console.log('【リプライ1】', content.reply1.slice(0, 200));
  console.log('【リプライ2】', content.reply2.slice(0, 200));
  console.log('【画像プロンプト】', content.imgPrompt.slice(0, 200));

  // Claudeの最終発言全文を表示
  console.log('\n=== Claude最終発言（全文）===');
  console.log(content.rawClaude);

  if (!content.tweet || content.tweet.length < 5) {
    throw new Error('メインツイートが抽出できませんでした。Claudeの発言を確認してください。\n' + content.rawClaude.slice(0,1000));
  }

  // 3. 画像生成
  let imageUrl = null;
  if (content.imgPrompt) {
    try {
      imageUrl = await generateImage(content.imgPrompt);
      console.log('  画像URL:', imageUrl?.slice(0, 80));
    } catch (e) {
      console.warn('  ⚠️ 画像生成失敗（投稿は続行）:', e.message);
    }
  }

  // 4. 投稿
  const posted = await postTweets(content.tweet, content.reply1, content.reply2, imageUrl);

  console.log('\n✅ 全投稿完了！');
  console.log(JSON.stringify(posted, null, 2));

} catch (e) {
  console.error('\n❌ エラー:', e.message);
  process.exit(1);
}
