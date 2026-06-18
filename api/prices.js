const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function yahooChart(host, symbol) {
  const url = `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) { console.log(`[prices] ${host} ${symbol} → HTTP ${r.status}`); return null; }
    const d = await r.json();
    const price = d.chart?.result?.[0]?.meta?.regularMarketPrice ?? null;
    console.log(`[prices] ${host} ${symbol} → ${price}`);
    return price;
  } catch (err) {
    console.log(`[prices] ${host} ${symbol} → ${err.message}`);
    return null;
  }
}

async function stooqClose(code, suffix) {
  const url = `https://stooq.com/q/d/l/?s=${code.toLowerCase()}.${suffix}&i=d&l=1`;
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) { console.log(`[prices] stooq ${code}.${suffix} → HTTP ${r.status}`); return null; }
    const text = await r.text();
    const lines = text.trim().split('\n');
    if (lines.length < 2) return null;
    const close = parseFloat(lines[lines.length - 1].split(',')[4]);
    const price = isNaN(close) || close <= 0 ? null : close;
    console.log(`[prices] stooq ${code}.${suffix} → ${price}`);
    return price;
  } catch (err) {
    console.log(`[prices] stooq ${code}.${suffix} → ${err.message}`);
    return null;
  }
}

async function getPrice(symbol, type) {
  const base = symbol.replace(/\.T$/i, '');
  if (type === '米国株式') {
    return yahooChart('query1.finance.yahoo.com', symbol);
  }
  if (type === '国内株式') {
    // Stooq first; Yahoo Finance Japan as fallback
    return (await stooqClose(base, 'jp')) ?? (await yahooChart('query.finance.yahoo.co.jp', symbol));
  }
  if (type === '投資信託') {
    // Yahoo Finance Japan for fund NAV
    return yahooChart('query.finance.yahoo.co.jp', symbol);
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { tickers } = req.body; // [{symbol, type}]
  if (!tickers?.length) {
    return res.json({ prices: {}, fetched: 0, requested: 0, updatedAt: new Date().toISOString() });
  }

  const pairs = await Promise.all(
    tickers.map(async ({ symbol, type }) => [symbol, await getPrice(symbol, type)])
  );
  const prices = Object.fromEntries(pairs.filter(([, p]) => p != null));

  console.log(`[prices] done: ${Object.keys(prices).length}/${tickers.length}`);
  res.json({ prices, fetched: Object.keys(prices).length, requested: tickers.length, updatedAt: new Date().toISOString() });
}
