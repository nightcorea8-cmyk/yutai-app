import React, { useState, useEffect, useCallback, useRef } from 'react';
import { db } from '../firebase.js';
import {
  collection, onSnapshot, addDoc, deleteDoc, updateDoc, setDoc,
  doc, serverTimestamp,
} from 'firebase/firestore';

function formatJPY(n) {
  return new Intl.NumberFormat('ja-JP').format(Math.abs(n));
}

function formatTs(ts) {
  if (!ts) return null;
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const ASSET_TYPES = [
  { value: 'bank', label: '銀行口座' },
  { value: 'securities', label: '証券口座' },
];

function typeLabel(type) {
  return type === 'bank' ? '銀行口座' : '証券口座';
}

function typeColor(type) {
  return type === 'bank' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700';
}

const EMPTY_FORM = { name: '', type: 'bank', amount: '', note: '', tag: '' };

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

async function readFileAsText(file) {
  const buffer = await file.arrayBuffer();
  const jpRe = /[　-鿿＀-￯]/;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    if (jpRe.test(text)) return text;
  } catch {}
  try {
    const text = new TextDecoder('shift-jis').decode(buffer);
    if (jpRe.test(text)) return text;
  } catch {}
  return new TextDecoder('utf-8').decode(buffer);
}

function parseRakutenSecuritiesCSV(text) {
  const lines = text.split(/\r?\n/);
  const items = [];
  let inDetailSection = false;
  let headerFound = false;
  let colMap = { type: 0, ticker: 1, name: 2, account: 3, quantity: 4, unit: 5, avgCost: 6, currentPrice: 8, valueJPY: 14, pnlJPY: 16, pnlPct: 17 };

  for (const line of lines) {
    if (!line.trim()) continue;
    const cols = parseCSVLine(line);

    if (cols.some((c) => c.includes('保有商品詳細'))) {
      inDetailSection = true;
      continue;
    }
    if (!inDetailSection) continue;
    if ((cols[0] || '').includes('参考為替')) break;

    if (!headerFound) {
      if (cols.some((c) => c.includes('種別') || c.includes('銘柄コード'))) {
        headerFound = true;
        const fi = (keyword) => cols.findIndex((c) => c.includes(keyword));
        const vJPY = cols.findIndex((c) => c.includes('時価評価額') && c.includes('円'));
        const pJPY = cols.findIndex((c) => c.includes('評価損益') && c.includes('円'));
        const pPct = cols.findIndex((c) => c.includes('評価損益') && c.includes('％'));
        colMap = {
          type: Math.max(0, fi('種別')),
          ticker: Math.max(1, fi('銘柄コード')),
          name: Math.max(2, fi('銘柄')),
          account: Math.max(3, fi('口座')),
          quantity: Math.max(4, fi('保有数量')),
          unit: 5,
          avgCost: 6,
          currentPrice: 8,
          valueJPY: vJPY >= 0 ? vJPY : 14,
          pnlJPY: pJPY >= 0 ? pJPY : 16,
          pnlPct: pPct >= 0 ? pPct : 17,
        };
      }
      continue;
    }

    const type = (cols[colMap.type] || '').trim();
    const name = (cols[colMap.name] || '').trim();
    if (!type || !name) continue;
    if (!['国内株式', '米国株式', '投資信託', '楽天・マネーファンド', '外貨建MMF', '国内債券', '外国債券', '金・プラチナ'].includes(type)) continue;

    const parseNum = (s) => {
      if (!s || s === '-') return 0;
      return parseFloat(s.replace(/,/g, '').replace(/^[+＋]/, '')) || 0;
    };

    const valueJPY = parseNum(cols[colMap.valueJPY]);
    if (valueJPY === 0) continue;

    items.push({
      type,
      ticker: (cols[colMap.ticker] || '').trim(),
      name,
      account: (cols[colMap.account] || '').trim(),
      quantity: parseNum(cols[colMap.quantity]),
      unit: (cols[colMap.unit] || '株').trim(),
      avgCost: parseNum(cols[colMap.avgCost]),
      currentPrice: parseNum(cols[colMap.currentPrice]),
      currentValueJPY: valueJPY,
      unrealizedPnL: parseNum(cols[colMap.pnlJPY]),
      unrealizedPnLPct: parseNum(cols[colMap.pnlPct]),
    });
  }
  return items;
}

const HOLDING_TYPE_ORDER = ['国内株式', '米国株式', '投資信託', '楽天・マネーファンド', '外貨建MMF', '国内債券', '外国債券', '金・プラチナ'];
const HOLDING_TYPE_LABEL = {
  '国内株式': '国内株式', '米国株式': '米国株式', '投資信託': '投資信託',
  '楽天・マネーファンド': 'MRF', '外貨建MMF': '外貨MMF',
  '国内債券': '国内債券', '外国債券': '外国債券', '金・プラチナ': '金・Pt',
};

const SKIP_PRICE_TYPES = new Set(['楽天・マネーファンド', '外貨建MMF', '外国債券', '国内債券', '金・プラチナ']);

function formatTime(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function Assets() {
  const [assets, setAssets] = useState([]);
  const [portfolios, setPortfolios] = useState({});
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const [pendingItems, setPendingItems] = useState([]);
  const [pendingTotalJPY, setPendingTotalJPY] = useState(0);
  const [showNameModal, setShowNameModal] = useState(false);
  const [accountName, setAccountName] = useState('');
  const [stockImporting, setStockImporting] = useState(false);
  const [stockCsvError, setStockCsvError] = useState('');
  const stockFileRef = useRef(null);

  const [expandedAssetId, setExpandedAssetId] = useState(null);
  const [expandedTypeKey, setExpandedTypeKey] = useState(null);
  const formRef = useRef(null);

  const [latestPrices, setLatestPrices] = useState({});
  const [pricesUpdatedAt, setPricesUpdatedAt] = useState(null);
  const [pricesFetching, setPricesFetching] = useState(false);
  const [priceViewMode, setPriceViewMode] = useState('csv');
  const [pricesFetchedCount, setPricesFetchedCount] = useState(null);
  const [pricesRequestedCount, setPricesRequestedCount] = useState(null);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'assets'), (snap) => {
      setAssets(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }, () => { setLoading(false); });
    return unsub;
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'stockPortfolio'), (snap) => {
      const map = {};
      snap.docs.forEach((d) => { map[d.id] = d.data(); });
      setPortfolios(map);
    }, () => {});
    return unsub;
  }, []);

  const fetchLatestPrices = useCallback(async () => {
    const allItems = Object.values(portfolios).flatMap((p) => p.items || []);
    const symbolSet = new Set();
    allItems.forEach((item) => {
      if (!item.ticker || SKIP_PRICE_TYPES.has(item.type) || item.currentPrice <= 0) return;
      symbolSet.add(item.type === '米国株式' ? item.ticker : `${item.ticker}.T`);
    });
    if (!symbolSet.size) return;
    setPricesFetching(true);
    try {
      const r = await fetch('/api/prices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickers: [...symbolSet] }),
      });
      const d = await r.json();
      if (d.prices) {
        setLatestPrices(d.prices);
        setPricesUpdatedAt(new Date(d.updatedAt));
        setPricesFetchedCount(d.fetched ?? Object.keys(d.prices).length);
        setPricesRequestedCount(d.requested ?? [...symbolSet].length);
      }
    } catch (err) {
      console.error('fetchLatestPrices error:', err.message);
    } finally {
      setPricesFetching(false);
    }
  }, [portfolios]);

  useEffect(() => {
    fetchLatestPrices();
    const id = setInterval(fetchLatestPrices, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [fetchLatestPrices]);

  const getLatestValue = useCallback((item) => {
    if (!item.ticker || item.currentPrice <= 0 || SKIP_PRICE_TYPES.has(item.type)) return null;
    const symbol = item.type === '米国株式' ? item.ticker : `${item.ticker}.T`;
    const lp = latestPrices[symbol];
    if (lp == null) return null;
    return Math.round(item.currentValueJPY * (lp / item.currentPrice));
  }, [latestPrices]);

  const getAssetDisplayAmount = useCallback((asset) => {
    if (priceViewMode !== 'latest' || asset.source !== 'rakuten') return asset.amount || 0;
    const p = asset.portfolioId ? portfolios[asset.portfolioId] : null;
    if (!p) return asset.amount || 0;
    return (p.items || []).reduce((s, item) => s + (getLatestValue(item) ?? item.currentValueJPY), 0);
  }, [priceViewMode, portfolios, getLatestValue]);

  const totalAssets = assets.reduce((s, a) => s + getAssetDisplayAmount(a), 0);

  const byType = [
    { type: 'bank', label: '銀行口座', color: 'bg-blue-100 text-blue-700', sum: assets.filter((a) => a.type === 'bank').reduce((s, a) => s + getAssetDisplayAmount(a), 0) },
    { type: 'securities', label: '証券口座', color: 'bg-purple-100 text-purple-700', sum: assets.filter((a) => a.type !== 'bank').reduce((s, a) => s + getAssetDisplayAmount(a), 0) },
  ].filter((t) => t.sum > 0);

  const sortedAssets = assets.slice().sort((a, b) => {
    const hasOA = a.order !== undefined && a.order !== null;
    const hasOB = b.order !== undefined && b.order !== null;
    if (hasOA && hasOB) return a.order - b.order;
    if (hasOA) return -1;
    if (hasOB) return 1;
    return (b.amount || 0) - (a.amount || 0);
  });

  const handleMove = useCallback(async (assetId, direction) => {
    const sorted = assets.slice().sort((a, b) => {
      const hasOA = a.order !== undefined && a.order !== null;
      const hasOB = b.order !== undefined && b.order !== null;
      if (hasOA && hasOB) return a.order - b.order;
      if (hasOA) return -1;
      if (hasOB) return 1;
      return (b.amount || 0) - (a.amount || 0);
    });
    const idx = sorted.findIndex((a) => a.id === assetId);
    if (idx < 0) return;
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= sorted.length) return;
    const current = sorted[idx];
    const target = sorted[targetIdx];
    const needsInit = sorted.some((a) => a.order === undefined || a.order === null);
    if (needsInit) {
      await Promise.all(sorted.map((a, i) => {
        let order = i;
        if (a.id === current.id) order = targetIdx;
        else if (a.id === target.id) order = idx;
        return updateDoc(doc(db, 'assets', a.id), { order });
      }));
    } else {
      await Promise.all([
        updateDoc(doc(db, 'assets', current.id), { order: target.order }),
        updateDoc(doc(db, 'assets', target.id), { order: current.order }),
      ]);
    }
  }, [assets]);

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    if (!form.name.trim() || !form.amount) return;
    setSubmitting(true);
    try {
      if (editingId) {
        await updateDoc(doc(db, 'assets', editingId), {
          name: form.name.trim(), type: form.type, amount: Number(form.amount),
          note: form.note.trim(), tag: form.tag.trim(), updatedAt: serverTimestamp(),
        });
        setEditingId(null);
      } else {
        const maxOrder = sortedAssets.length > 0 ? (sortedAssets[sortedAssets.length - 1].order ?? sortedAssets.length - 1) + 1 : 0;
        await addDoc(collection(db, 'assets'), {
          name: form.name.trim(), type: form.type, amount: Number(form.amount),
          note: form.note.trim(), tag: form.tag.trim(), order: maxOrder, createdAt: serverTimestamp(),
        });
      }
      setForm(EMPTY_FORM);
      setShowForm(false);
    } catch (err) {
      console.error(err);
      alert('保存に失敗しました');
    } finally {
      setSubmitting(false);
    }
  }, [form, editingId, sortedAssets]);

  const startEdit = useCallback((asset) => {
    setEditingId(asset.id);
    setForm({ name: asset.name || '', type: asset.type === 'bank' ? 'bank' : 'securities', amount: String(asset.amount || ''), note: asset.note || '', tag: asset.tag || '' });
    setShowForm(true);
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowForm(false);
  }, []);

  const handleDelete = useCallback(async (asset) => {
    if (!confirm('この資産を削除しますか？')) return;
    try {
      if (asset.source === 'rakuten' && asset.portfolioId) {
        await deleteDoc(doc(db, 'stockPortfolio', asset.portfolioId));
      }
      await deleteDoc(doc(db, 'assets', asset.id));
    } catch {
      alert('削除に失敗しました');
    }
  }, []);

  const handleStockFile = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setStockCsvError('');
    try {
      const text = await readFileAsText(file);
      const items = parseRakutenSecuritiesCSV(text);
      if (items.length === 0) {
        setStockCsvError('楽天証券の資産残高CSVを選択してください（「資産残高一覧」からダウンロード）。');
        return;
      }
      const total = items.reduce((s, i) => s + i.currentValueJPY, 0);
      setPendingItems(items);
      setPendingTotalJPY(total);
      setAccountName('');
      setShowNameModal(true);
    } catch (err) {
      console.error(err);
      setStockCsvError('読み込みに失敗しました。');
    }
  }, []);

  const handleImportConfirm = useCallback(async () => {
    const name = accountName.trim();
    if (!name) return;
    setShowNameModal(false);
    setStockImporting(true);
    try {
      const existing = assets.find((a) => a.source === 'rakuten' && a.name === name);
      let portfolioId;
      if (existing) {
        portfolioId = existing.portfolioId;
        await updateDoc(doc(db, 'assets', existing.id), {
          amount: pendingTotalJPY,
          tag: '楽天証券',
          updatedAt: serverTimestamp(),
        });
      } else {
        portfolioId = `rakuten_${Date.now()}`;
        const maxOrder = sortedAssets.length > 0 ? (sortedAssets[sortedAssets.length - 1].order ?? sortedAssets.length - 1) + 1 : 0;
        await addDoc(collection(db, 'assets'), {
          source: 'rakuten',
          portfolioId,
          name,
          type: 'securities',
          amount: pendingTotalJPY,
          tag: '楽天証券',
          order: maxOrder,
          createdAt: serverTimestamp(),
        });
      }
      await setDoc(doc(db, 'stockPortfolio', portfolioId), {
        items: pendingItems,
        totalValueJPY: pendingTotalJPY,
        accountName: name,
        importedAt: serverTimestamp(),
      });
      setPendingItems([]);
      setPendingTotalJPY(0);
    } catch (err) {
      console.error(err);
      alert('インポートに失敗しました');
    } finally {
      setStockImporting(false);
    }
  }, [accountName, assets, pendingItems, pendingTotalJPY, sortedAssets]);

  const toggleAssetExpand = useCallback((assetId) => {
    setExpandedAssetId((prev) => (prev === assetId ? null : assetId));
    setExpandedTypeKey(null);
  }, []);

  const toggleTypeExpand = useCallback((key) => {
    setExpandedTypeKey((prev) => (prev === key ? null : key));
  }, []);

  const existingRakutenNames = assets.filter((a) => a.source === 'rakuten').map((a) => a.name);

  return (
    <div className="p-5 max-w-2xl mx-auto">
      <div className="mb-5">
        <h1 className="text-lg font-bold text-gray-800">資産管理</h1>
      </div>

      {/* 資産総額 */}
      <div className="bg-white rounded-2xl shadow-sm border border-black/5 p-6 mb-5">
        <p className="text-sm text-gray-500 mb-2">資産総額</p>
        <p className="text-4xl font-bold text-[#c47c2b]">¥{formatJPY(totalAssets)}</p>

        {byType.length > 0 && (
          <div className="mt-4 space-y-2">
            {byType.map(({ type, label, color, sum }) => {
              const pct = totalAssets > 0 ? Math.round((sum / totalAssets) * 100) : 0;
              return (
                <div key={type}>
                  <div className="flex items-center justify-between mb-1">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${color}`}>{label}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400">{pct}%</span>
                      <span className="text-sm font-medium text-gray-700">¥{formatJPY(sum)}</span>
                    </div>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-[#c47c2b] rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 楽天証券 CSVインポート */}
      <input ref={stockFileRef} type="file" accept=".csv" className="hidden" onChange={handleStockFile} />
      <button
        onClick={() => { setStockCsvError(''); stockFileRef.current?.click(); }}
        disabled={stockImporting}
        className="w-full py-2 mb-1 bg-white border border-dashed border-[#6b4aa0]/40 text-[#6b4aa0] rounded-xl text-xs font-medium hover:bg-[#6b4aa0]/5 transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 flex-shrink-0">
          <polyline points="16 16 12 12 8 16" />
          <line x1="12" y1="12" x2="12" y2="21" />
          <path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3" />
        </svg>
        {stockImporting ? '読み込み中…' : '楽天証券 資産残高 CSV'}
      </button>
      {stockCsvError && <p className="text-xs text-[#b83232] text-center mb-1">{stockCsvError}</p>}

      {/* 口座名入力モーダル */}
      {showNameModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl p-5 w-full max-w-sm">
            <h3 className="text-sm font-bold text-gray-800 mb-1">口座名を入力</h3>
            <p className="text-xs text-gray-400 mb-3">インポートする楽天証券の口座名を設定してください（同名で上書きされます）</p>
            {existingRakutenNames.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {existingRakutenNames.map((n) => (
                  <button
                    key={n}
                    onClick={() => setAccountName(n)}
                    className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${accountName === n ? 'bg-[#6b4aa0] text-white border-[#6b4aa0]' : 'border-[#6b4aa0]/30 text-[#6b4aa0] hover:bg-[#6b4aa0]/10'}`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            )}
            <input
              type="text"
              value={accountName}
              onChange={(e) => setAccountName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && accountName.trim()) handleImportConfirm(); }}
              placeholder="例：楽天証券（夫）"
              autoFocus
              className="w-full px-3 py-2.5 text-sm border border-black/15 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#6b4aa0] mb-3"
            />
            <div className="flex gap-2">
              <button
                onClick={() => { setShowNameModal(false); setPendingItems([]); setPendingTotalJPY(0); }}
                className="px-4 py-2.5 text-sm border border-black/15 rounded-xl text-gray-600 hover:bg-gray-50 transition-colors"
              >
                キャンセル
              </button>
              <button
                onClick={handleImportConfirm}
                disabled={!accountName.trim()}
                className="flex-1 py-2.5 bg-[#6b4aa0] text-white rounded-xl font-medium text-sm disabled:opacity-40 hover:bg-[#5a3d87] transition-colors"
              >
                インポート
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 資産を追加ボタン */}
      {!showForm && (
        <button
          onClick={() => { setShowForm(true); setEditingId(null); setForm(EMPTY_FORM); }}
          className="w-full py-3.5 bg-[#2d5f3f] text-white rounded-xl font-semibold text-base hover:bg-[#24502f] transition-colors mb-5 mt-3 flex items-center justify-center gap-2"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          資産を追加
        </button>
      )}

      {/* 追加フォーム */}
      {showForm && (
        <div ref={formRef} className="bg-white rounded-2xl shadow-sm border border-black/5 p-4 mb-5 mt-3">
          <h2 className="text-sm font-bold text-gray-800 mb-3">{editingId ? '資産を編集' : '資産を追加'}</h2>
          <form onSubmit={handleSubmit}>
            <div className="mb-3">
              <label className="block text-xs text-gray-500 mb-1 font-medium">名称 *</label>
              <input type="text" value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="例：三菱UFJ銀行" required
                className="w-full px-3 py-2.5 text-sm border border-black/15 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#2d5f3f]" />
            </div>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1 font-medium">種類</label>
                <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
                  className="w-full px-3 py-2.5 text-sm border border-black/15 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#2d5f3f] bg-white">
                  {ASSET_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1 font-medium">金額 *</label>
                <div className="relative">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs">¥</span>
                  <input type="number" min="0" value={form.amount}
                    onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                    placeholder="0" required
                    className="w-full pl-6 pr-2 py-2.5 text-sm border border-black/15 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#2d5f3f]" />
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1 font-medium">タグ（任意）</label>
                <input type="text" value={form.tag}
                  onChange={(e) => setForm((f) => ({ ...f, tag: e.target.value }))}
                  placeholder="例：夫婦共有"
                  className="w-full px-3 py-2.5 text-sm border border-black/15 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#2d5f3f]" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1 font-medium">メモ（任意）</label>
                <input type="text" value={form.note}
                  onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                  placeholder="例：普通口座"
                  className="w-full px-3 py-2.5 text-sm border border-black/15 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#2d5f3f]" />
              </div>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={cancelEdit}
                className="px-4 py-2.5 text-sm border border-black/15 rounded-xl text-gray-600 hover:bg-gray-50 transition-colors">
                キャンセル
              </button>
              <button type="submit" disabled={submitting}
                className="flex-1 py-2.5 bg-[#2d5f3f] text-white rounded-xl font-medium text-sm disabled:opacity-50 hover:bg-[#24502f] transition-colors">
                {submitting ? '保存中…' : editingId ? '更新する' : '追加する'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* 資産一覧 */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-7 h-7 border-2 border-gray-200 border-t-[#2d5f3f] rounded-full animate-spin-custom" />
        </div>
      ) : assets.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-10 h-10 mx-auto mb-2 text-gray-300">
            <rect x="2" y="7" width="20" height="14" rx="2" />
            <path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2" />
          </svg>
          <p className="text-sm">資産が登録されていません</p>
        </div>
      ) : (
        <div>
          {assets.some((a) => a.source === 'rakuten') && (
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs text-gray-400">
                {priceViewMode === 'latest' && pricesUpdatedAt
                  ? `更新 ${formatTime(pricesUpdatedAt)}（${pricesFetchedCount}/${pricesRequestedCount}銘柄）`
                  : priceViewMode === 'latest' && !pricesUpdatedAt && !pricesFetching
                  ? '取得失敗'
                  : 'CSVインポート時の評価額'}
              </span>
              <div className="flex items-center gap-2">
                {pricesFetching ? (
                  <div className="w-3 h-3 border-2 border-gray-200 border-t-[#6b4aa0] rounded-full animate-spin" />
                ) : (
                  <button
                    onClick={fetchLatestPrices}
                    className="text-gray-300 hover:text-[#6b4aa0] transition-colors p-0.5"
                    aria-label="価格を更新"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
                      <polyline points="23 4 23 10 17 10" />
                      <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
                    </svg>
                  </button>
                )}
                <div className="flex bg-gray-100 rounded-lg p-0.5 gap-0.5">
                  <button
                    onClick={() => setPriceViewMode('csv')}
                    className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${priceViewMode === 'csv' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                  >
                    CSV
                  </button>
                  <button
                    onClick={() => { setPriceViewMode('latest'); if (!pricesUpdatedAt) fetchLatestPrices(); }}
                    className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${priceViewMode === 'latest' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                  >
                    最新
                  </button>
                </div>
              </div>
            </div>
          )}
        <div className="space-y-2">
          {sortedAssets.map((asset, listIdx) => {
            const isRakuten = asset.source === 'rakuten';
            const isExpanded = expandedAssetId === asset.id;
            const portfolio = isRakuten && asset.portfolioId ? portfolios[asset.portfolioId] : null;
            const holdingsByType = portfolio
              ? HOLDING_TYPE_ORDER
                  .map((t) => ({ type: t, label: HOLDING_TYPE_LABEL[t] || t, items: (portfolio.items || []).filter((i) => i.type === t) }))
                  .filter((g) => g.items.length > 0)
              : [];
            const isFirst = listIdx === 0;
            const isLast = listIdx === sortedAssets.length - 1;

            return (
              <div key={asset.id} className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
                {/* メイン行 */}
                <div className="px-3 py-4 flex items-center gap-2">
                  {/* 並び替えボタン */}
                  <div className="flex flex-col gap-0.5 flex-shrink-0">
                    <button
                      onClick={() => handleMove(asset.id, 'up')}
                      disabled={isFirst}
                      className="text-gray-300 hover:text-gray-500 disabled:opacity-20 transition-colors p-0.5"
                      aria-label="上へ"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-3.5 h-3.5">
                        <polyline points="18 15 12 9 6 15" />
                      </svg>
                    </button>
                    <button
                      onClick={() => handleMove(asset.id, 'down')}
                      disabled={isLast}
                      className="text-gray-300 hover:text-gray-500 disabled:opacity-20 transition-colors p-0.5"
                      aria-label="下へ"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-3.5 h-3.5">
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </button>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${typeColor(asset.type)}`}>
                        {typeLabel(asset.type)}
                      </span>
                      {isRakuten && (
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-[#ede9f5] text-[#6b4aa0]">楽天証券</span>
                      )}
                      {asset.tag && (
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-gray-100 text-gray-500">{asset.tag}</span>
                      )}
                    </div>
                    <p className="text-sm font-medium text-gray-800 truncate">{asset.name}</p>
                    {asset.note && <p className="text-xs text-gray-400 truncate">{asset.note}</p>}
                    {(asset.updatedAt || asset.createdAt) && (
                      <p className="text-xs text-gray-300 truncate">
                        {asset.updatedAt ? '更新' : '追加'} {formatTs(asset.updatedAt || asset.createdAt)}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-1 flex-shrink-0">
                    <span className="text-base font-bold text-gray-800 mr-1">¥{formatJPY(getAssetDisplayAmount(asset))}</span>
                    {isRakuten ? (
                      <>
                        <button
                          onClick={() => toggleAssetExpand(asset.id)}
                          className="text-gray-400 hover:text-[#6b4aa0] transition-colors p-1.5"
                          aria-label="詳細を表示"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                            className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
                            <polyline points="6 9 12 15 18 9" />
                          </svg>
                        </button>
                        <button
                          onClick={() => handleDelete(asset)}
                          className="text-gray-300 hover:text-[#b83232] transition-colors p-1.5"
                          aria-label="削除"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6l-1 14H6L5 6M10 11v6M14 11v6M9 6V4h6v2" />
                          </svg>
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => startEdit(asset)}
                          className="text-gray-400 hover:text-[#2d5f3f] transition-colors p-1.5"
                          aria-label="編集"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
                            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => handleDelete(asset)}
                          className="text-gray-300 hover:text-[#b83232] transition-colors p-1.5"
                          aria-label="削除"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6l-1 14H6L5 6M10 11v6M14 11v6M9 6V4h6v2" />
                          </svg>
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* 保有銘柄ドリルダウン（楽天証券のみ） */}
                {isExpanded && isRakuten && (
                  <div className="border-t border-black/5">
                    {holdingsByType.length === 0 ? (
                      <p className="text-xs text-gray-400 py-3 px-5">銘柄データがありません</p>
                    ) : (
                      holdingsByType.map(({ type, label, items }) => {
                        const typeTotal = items.reduce((s, i) => s + (priceViewMode === 'latest' ? (getLatestValue(i) ?? i.currentValueJPY) : i.currentValueJPY), 0);
                        const typePnL = items.reduce((s, i) => {
                          if (priceViewMode !== 'latest') return s + i.unrealizedPnL;
                          const lv = getLatestValue(i);
                          return s + (lv != null ? lv - (i.currentValueJPY - i.unrealizedPnL) : i.unrealizedPnL);
                        }, 0);
                        const typeKey = `${asset.portfolioId}::${type}`;
                        const isTypeExpanded = expandedTypeKey === typeKey;

                        return (
                          <div key={type} className="border-b border-black/5 last:border-b-0">
                            <button
                              onClick={() => toggleTypeExpand(typeKey)}
                              className="w-full px-5 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors"
                            >
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">{label}</span>
                                <span className="text-xs text-gray-400">{items.length}銘柄</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <div className="text-right">
                                  <p className="text-sm font-bold text-gray-800">¥{formatJPY(typeTotal)}</p>
                                  <p className={`text-xs font-medium ${typePnL >= 0 ? 'text-[#2d5f3f]' : 'text-[#b83232]'}`}>
                                    {typePnL >= 0 ? '+' : ''}¥{formatJPY(typePnL)}
                                  </p>
                                </div>
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                                  className={`w-4 h-4 text-gray-400 transition-transform flex-shrink-0 ${isTypeExpanded ? 'rotate-180' : ''}`}>
                                  <polyline points="6 9 12 15 18 9" />
                                </svg>
                              </div>
                            </button>

                            {isTypeExpanded && (
                              <div className="divide-y divide-black/5 bg-gray-50/50">
                                {items.map((item, i) => {
                                  const lv = getLatestValue(item);
                                  const displayValue = priceViewMode === 'latest' ? (lv ?? item.currentValueJPY) : item.currentValueJPY;
                                  const costBasis = item.currentValueJPY - item.unrealizedPnL;
                                  const displayPnL = priceViewMode === 'latest' && lv != null ? lv - costBasis : item.unrealizedPnL;
                                  const displayPnLPct = priceViewMode === 'latest' && lv != null && costBasis > 0 ? (lv / costBasis - 1) * 100 : item.unrealizedPnLPct;
                                  const isStale = priceViewMode === 'latest' && lv == null && !SKIP_PRICE_TYPES.has(item.type) && item.ticker;
                                  return (
                                  <div key={i} className="px-5 py-3 flex items-center gap-3">
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-1.5 flex-wrap">
                                        <p className="text-sm font-medium text-gray-800 truncate">{item.name}</p>
                                        {item.ticker && (
                                          <span className="text-xs text-gray-400 font-mono flex-shrink-0">{item.ticker}</span>
                                        )}
                                        {isStale && (
                                          <span className="text-[10px] text-gray-300 flex-shrink-0">CSV</span>
                                        )}
                                      </div>
                                      <p className="text-xs text-gray-400 mt-0.5">
                                        {item.account} · {new Intl.NumberFormat('ja-JP').format(item.quantity)}{item.unit}
                                      </p>
                                    </div>
                                    <div className="text-right flex-shrink-0">
                                      <p className="text-sm font-bold text-gray-800">¥{formatJPY(displayValue)}</p>
                                      <p className={`text-xs font-medium ${displayPnL >= 0 ? 'text-[#2d5f3f]' : 'text-[#b83232]'}`}>
                                        {displayPnL >= 0 ? '+' : ''}¥{formatJPY(displayPnL)}
                                        <span className="text-gray-400 font-normal ml-1">
                                          ({displayPnLPct >= 0 ? '+' : ''}{displayPnLPct.toFixed(2)}%)
                                        </span>
                                      </p>
                                    </div>
                                  </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        </div>
      )}
    </div>
  );
}
