const SKIP_TYPES = new Set(['楽天・マネーファンド', '外貨建MMF', '外国債券', '国内債券', '金・プラチナ']);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { tickers } = req.body;
  if (!tickers || !tickers.length) {
    return res.json({ prices: {}, updatedAt: new Date().toISOString() });
  }

  const symbols = tickers.join(',');
  const url = `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols)}&lang=ja&region=JP`;

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'ja-JP,ja;q=0.9,en;q=0.8',
        'Referer': 'https://finance.yahoo.com/',
      },
    });

    if (!response.ok) {
      return res.status(502).json({ error: `upstream HTTP ${response.status}` });
    }

    const data = await response.json();
    const quotes = data.quoteResponse?.result || [];
    const prices = {};
    quotes.forEach((q) => {
      if (q.regularMarketPrice != null) {
        prices[q.symbol] = q.regularMarketPrice;
      }
    });

    res.json({ prices, updatedAt: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
