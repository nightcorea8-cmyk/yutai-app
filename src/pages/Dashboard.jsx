import React, { useState, useEffect } from 'react';
import { db } from '../firebase.js';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { Link } from 'react-router-dom';

function formatJPY(n) {
  return new Intl.NumberFormat('ja-JP').format(Math.abs(n));
}

function getCurrentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function daysLeft(ds) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((new Date(ds) - today) / 86400000);
}

const EXPENSE_CATEGORIES = ['食費', '外食', '日用品', '交通費', '娯楽', '医療', '教育', '住居', '光熱費', '通信費', '服飾', 'その他'];

export default function Dashboard() {
  const [transactions, setTransactions] = useState([]);
  const [assets, setAssets] = useState([]);
  const [stocks, setStocks] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubs = [];

    const tq = query(collection(db, 'transactions'), orderBy('createdAt', 'desc'));
    unsubs.push(onSnapshot(tq, (snap) => {
      setTransactions(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    }, () => {}));

    unsubs.push(onSnapshot(collection(db, 'assets'), (snap) => {
      setAssets(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }, () => { setLoading(false); }));

    const sq = query(collection(db, 'stocks'), orderBy('createdAt', 'desc'));
    unsubs.push(onSnapshot(sq, (snap) => {
      setStocks(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    }, () => {}));

    return () => unsubs.forEach((u) => u());
  }, []);

  const currentMonth = getCurrentMonth();

  const monthlyTx = transactions.filter((t) => t.date && t.date.startsWith(currentMonth));
  const totalIncome = monthlyTx.filter((t) => t.type === 'income').reduce((s, t) => s + (t.amount || 0), 0);
  const totalExpense = monthlyTx.filter((t) => t.type === 'expense').reduce((s, t) => s + (t.amount || 0), 0);
  const balance = totalIncome - totalExpense;

  const totalAssets = assets.reduce((s, a) => s + (a.amount || 0), 0);

  // Expiring stocks (next 30 days)
  const expiringStocks = stocks
    .filter((s) => s.expiry)
    .map((s) => ({ ...s, dl: daysLeft(s.expiry) }))
    .filter((s) => s.dl >= 0 && s.dl <= 30)
    .sort((a, b) => a.dl - b.dl);

  // Top 3 expense categories this month
  const expByCategory = {};
  monthlyTx
    .filter((t) => t.type === 'expense')
    .forEach((t) => {
      expByCategory[t.category] = (expByCategory[t.category] || 0) + (t.amount || 0);
    });
  const topCategories = Object.entries(expByCategory)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  const maxCatAmount = topCategories.length > 0 ? topCategories[0][1] : 1;

  const summaryCards = [
    {
      label: '今月の収入',
      value: `¥${formatJPY(totalIncome)}`,
      color: 'text-[#2d5f3f]',
      bg: 'bg-[#e8f0eb]',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5">
          <path d="M12 19V5M5 12l7-7 7 7" />
        </svg>
      ),
    },
    {
      label: '今月の支出',
      value: `¥${formatJPY(totalExpense)}`,
      color: 'text-[#b83232]',
      bg: 'bg-[#fbeaea]',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5">
          <path d="M12 5v14M19 12l-7 7-7-7" />
        </svg>
      ),
    },
    {
      label: '今月の収支',
      value: `${balance >= 0 ? '+' : '-'}¥${formatJPY(balance)}`,
      color: balance >= 0 ? 'text-[#2d5f3f]' : 'text-[#b83232]',
      bg: balance >= 0 ? 'bg-[#e8f0eb]' : 'bg-[#fbeaea]',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5">
          <path d="M2 12h20M12 2v20" />
        </svg>
      ),
    },
    {
      label: '資産総額',
      value: `¥${formatJPY(totalAssets)}`,
      color: 'text-[#c47c2b]',
      bg: 'bg-[#faf0e2]',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5">
          <rect x="2" y="7" width="20" height="14" rx="2" />
          <path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2" />
        </svg>
      ),
    },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-64 p-8">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-gray-200 border-t-[#2d5f3f] rounded-full animate-spin-custom mx-auto mb-3" />
          <p className="text-sm text-gray-500">読み込み中…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 max-w-2xl mx-auto lg:max-w-3xl">
      {/* Month label */}
      <div className="mb-4">
        <h1 className="text-base font-bold text-gray-800">ダッシュボード</h1>
        <p className="text-xs text-gray-400 mt-0.5">{currentMonth.replace('-', '年')}月</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 mb-5">
        {summaryCards.map((card) => (
          <div key={card.label} className="bg-white rounded-2xl shadow-sm border border-black/5 p-4">
            <div className={`w-8 h-8 ${card.bg} ${card.color} rounded-lg flex items-center justify-center mb-3`}>
              {card.icon}
            </div>
            <p className="text-xs text-gray-500 mb-1">{card.label}</p>
            <p className={`text-lg font-bold ${card.color} leading-tight`}>{card.value}</p>
          </div>
        ))}
      </div>

      {/* Expiring stocks */}
      <div className="bg-white rounded-2xl shadow-sm border border-black/5 p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-gray-800">期限間近の優待</h2>
          <Link to="/yutai" className="text-xs text-[#2d5f3f] font-medium">すべて見る →</Link>
        </div>
        {expiringStocks.length === 0 ? (
          <p className="text-xs text-gray-400 py-4 text-center">期限間近の優待はありません</p>
        ) : (
          <div className="space-y-2">
            {expiringStocks.slice(0, 5).map((s) => {
              const urgentClass = s.dl <= 7 ? 'text-[#b83232] bg-[#fbeaea]' : s.dl <= 30 ? 'text-[#c47c2b] bg-[#faf0e2]' : 'text-[#2d5f3f] bg-[#e8f0eb]';
              return (
                <div key={s.id} className="flex items-center gap-3">
                  {s.photo ? (
                    <div className="w-9 h-9 rounded-lg overflow-hidden flex-shrink-0">
                      <img src={s.photo} alt={s.name} className="w-full h-full object-cover" />
                    </div>
                  ) : (
                    <div className="w-9 h-9 rounded-lg bg-gray-100 flex-shrink-0 flex items-center justify-center">
                      <svg viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="1.5" className="w-4 h-4">
                        <rect x="2" y="3" width="20" height="14" rx="2" />
                        <path d="M8 21h8M12 17v4" />
                      </svg>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{s.name}</p>
                    <p className="text-xs text-gray-400">{s.expiry}</p>
                  </div>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${urgentClass}`}>
                    残{s.dl}日
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Top 3 expense categories */}
      <div className="bg-white rounded-2xl shadow-sm border border-black/5 p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-gray-800">今月の支出カテゴリ TOP3</h2>
          <Link to="/kakeibo" className="text-xs text-[#2d5f3f] font-medium">詳細 →</Link>
        </div>
        {topCategories.length === 0 ? (
          <p className="text-xs text-gray-400 py-4 text-center">今月の支出データがありません</p>
        ) : (
          <div className="space-y-3">
            {topCategories.map(([cat, amount], i) => {
              const pct = Math.round((amount / maxCatAmount) * 100);
              const colors = ['bg-[#2d5f3f]', 'bg-[#c47c2b]', 'bg-blue-400'];
              return (
                <div key={cat}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-gray-400">#{i + 1}</span>
                      <span className="text-sm text-gray-700">{cat}</span>
                    </div>
                    <span className="text-sm font-bold text-gray-800">¥{formatJPY(amount)}</span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${colors[i]} rounded-full`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
