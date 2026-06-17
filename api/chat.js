const GEMINI_MODELS = ['gemini-flash-lite-latest', 'gemini-flash-latest'];

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { messages, context } = req.body;
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Invalid messages' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  const systemInstruction = `あなたは経験豊富なファイナンシャルプランナー（FP）です。
日本の税制・社会保障・投資制度（NISA・iDeCoなど）に詳しく、ユーザーの家計データをもとに具体的で実践的なアドバイスを提供します。
専門用語はわかりやすく説明し、親しみやすく丁寧なトーンで話してください。
回答は簡潔にまとめ、必要に応じて箇条書きを使ってください。

${context ? `【ユーザーの現在の家計データ】\n${context}` : ''}`;

  const contents = messages.map((m) => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: m.content }],
  }));

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let lastError = '';
  for (const model of GEMINI_MODELS) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemInstruction }] },
            contents,
          }),
        });
        const data = await response.json();
        if (response.status === 503 || response.status === 429) {
          lastError = data.error?.message || `HTTP ${response.status}`;
          await sleep(1500 * (attempt + 1));
          continue;
        }
        if (!response.ok) {
          lastError = data.error?.message || `HTTP ${response.status}`;
          break;
        }
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) { lastError = 'Empty response'; break; }
        return res.json({ content: text });
      } catch (err) {
        lastError = err.message;
      }
    }
  }
  console.error('All models failed:', lastError);
  res.status(500).json({ error: lastError });
}
