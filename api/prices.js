const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function fetchPrice(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': UA,
        'Accept': 'application/json',
        'Referer': 'https://finance.yahoo.com',
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) {
      console.error(`[prices] ${symbol} → HTTP ${r.status}`);
      return null;
    }
    const data = await r.json();
    const meta = data.chart?.result?.[0]?.meta;
    const price = meta?.regularMarketPrice ?? null;
    if (price == null) console.error(`[prices] ${symbol} → no regularMarketPrice in response`);
    return price;
  } catch (err) {
    console.error(`[prices] ${symbol} → ${err.message}`);
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { tickers } = req.body;
  if (!tickers?.length) {
    return res.json({ prices: {}, fetched: 0, requested: 0, updatedAt: new Date().toISOString() });
  }

  const pairs = await Promise.all(tickers.map(async (s) => [s, await fetchPrice(s)]));
  const prices = Object.fromEntries(pairs.filter(([, p]) => p != null));

  res.json({
    prices,
    fetched: Object.keys(prices).length,
    requested: tickers.length,
    updatedAt: new Date().toISOString(),
  });
}
