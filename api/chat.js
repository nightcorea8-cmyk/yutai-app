import { GoogleGenerativeAI } from '@google/generative-ai';

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

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash', systemInstruction });

    const history = messages.slice(0, -1).map((m) => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.content }],
    }));

    const chat = model.startChat({ history });
    const lastMsg = messages[messages.length - 1];
    const result = await chat.sendMessage(lastMsg.content);
    const text = result.response.text();
    res.json({ content: text });
  } catch (err) {
    console.error('Gemini error:', err.message);
    res.status(500).json({ error: 'AI response failed' });
  }
}
