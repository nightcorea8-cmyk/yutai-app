const GEMINI_MODELS = ['gemini-2.0-flash-lite', 'gemini-1.5-flash-latest', 'gemini-flash-latest'];

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

  let lastError = '';
  for (const model of GEMINI_MODELS) {
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
      if (!response.ok) {
        lastError = data.error?.message || `HTTP ${response.status}`;
        continue;
      }
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) { lastError = 'Empty response'; continue; }
      return res.json({ content: text });
    } catch (err) {
      lastError = err.message;
    }
  }
  console.error('All models failed:', lastError);
  res.status(500).json({ error: lastError });
}
