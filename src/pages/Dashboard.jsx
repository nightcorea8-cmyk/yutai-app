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

function getMonthLabel(yyyymm) {
  const [y, m] = yyyymm.split('-');
  return `${y}年${parseInt(m, 10)}月`;
}

function shiftMonth(yyyymm, delta) {
  const [y, m] = yyyymm.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function daysLeft(ds) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((new Date(ds) - today) / 86400000);
}

export default function Dashboard() {
  const [transactions, setTransactions] = useState([]);
  const [assets, setAssets] = useState([]);
  const [stocks, setStocks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewMonth, setViewMonth] = useState(getCurrentMonth);

  useEffect(() => {
    const unsubs = [];

    const tq = query(collection(db, 'transactions'), orderBy('date', 'desc'));
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

  // データロード後、表示月にデータがなければ最新データのある月へ自動移動
  useEffect(() => {
    if (transactions.length === 0) return;
    const months = [...new Set(transactions.map((t) => t.date?.slice(0, 7)).filter(Boolean))].sort((a, b) => b.localeCompare(a));
    if (months.length > 0 && !transactions.some((t) => t.date?.startsWith(viewMonth))) {
      setViewMonth(months[0]);
    }
  }, [transactions]); // eslint-disable-line react-hooks/exhaustive-deps

  const availableMonths = [...new Set(
    transactions.map((t) => t.date?.slice(0, 7)).filter(Boolean)
  )].sort((a, b) => b.localeCompare(a));

  const monthlyTx = transactions.filter((t) => t.date?.startsWith(viewMonth));
  const totalIncome = monthlyTx.filter((t) => t.type === 'income').reduce((s, t) => s + (t.amount || 0), 0);
  const totalExpense = monthlyTx.filter((t) => t.type === 'expense').reduce((s, t) => s + (t.amount || 0), 0);
  const balance = totalIncome - totalExpense;
  const totalAssets = assets.reduce((s, a) => s + (a.amount || 0), 0);

  // 1ヶ月以内に期限が来る優待
  const expiringStocks = stocks
    .filter((s) => s.expiry)
    .map((s) => ({ ...s, dl: daysLeft(s.expiry) }))
    .filter((s) => s.dl >= 0 && s.dl <= 30)
    .sort((a, b) => a.dl - b.dl);

  const monthLabel = getMonthLabel(viewMonth);

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
    <div className="p-5 max-w-2xl mx-auto lg:max-w-3xl">
      {/* ヘッダー + 月ナビゲーター */}
      <div className="mb-5">
        <h1 className="text-lg font-bold text-gray-800 mb-3">ダッシュボード</h1>
        <div className="flex items-center justify-between">
          <button
            onClick={() => setViewMonth((m) => shiftMonth(m, -1))}
            className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-black/5 active:bg-black/10 transition-colors"
            aria-label="前の月"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-5 h-5 text-gray-500">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <div className="text-center">
            <p className="text-base font-bold text-gray-800">{monthLabel}</p>
            {availableMonths.includes(viewMonth) ? (
              <p className="text-xs text-[#2d5f3f] mt-0.5">● データあり</p>
            ) : (
              <p className="text-xs text-gray-300 mt-0.5">記録なし</p>
            )}
          </div>
          <button
            onClick={() => setViewMonth((m) => shiftMonth(m, 1))}
            className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-black/5 active:bg-black/10 transition-colors"
            aria-label="次の月"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-5 h-5 text-gray-500">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>
      </div>

      {/* 収入・支出・収支 — 1行3列 */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        {[
          { label: '収入', value: totalIncome, prefix: '+', color: 'text-[#2d5f3f]', bg: 'bg-[#e8f0eb]' },
          { label: '支出', value: totalExpense, prefix: '-', color: 'text-[#b83232]', bg: 'bg-[#fbeaea]' },
          { label: '収支', value: Math.abs(balance), prefix: balance >= 0 ? '+' : '-', color: balance >= 0 ? 'text-[#2d5f3f]' : 'text-[#b83232]', bg: balance >= 0 ? 'bg-[#e8f0eb]' : 'bg-[#fbeaea]' },
        ].map(({ label, value, prefix, color, bg }) => (
          <div key={label} className="bg-white rounded-2xl border border-black/5 shadow-sm px-3 py-3.5">
            <div className={`w-7 h-7 ${bg} ${color} rounded-lg flex items-center justify-center mb-2`}>
              {label === '収入' && (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                  <path d="M12 19V5M5 12l7-7 7 7" />
                </svg>
              )}
              {label === '支出' && (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                  <path d="M12 5v14M19 12l-7 7-7-7" />
                </svg>
              )}
              {label === '収支' && (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                  <path d="M2 12h20M12 2v20" />
                </svg>
              )}
            </div>
            <p className="text-xs text-gray-400 mb-1">{label}</p>
            <p className={`text-sm font-bold ${color} leading-tight`}>{prefix}¥{formatJPY(value)}</p>
          </div>
        ))}
      </div>

      {/* 資産総額 */}
      <div className="bg-white rounded-2xl border border-black/5 shadow-sm px-4 py-3.5 mb-5 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 bg-[#faf0e2] text-[#c47c2b] rounded-lg flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
              <rect x="2" y="7" width="20" height="14" rx="2" />
              <path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2" />
            </svg>
          </div>
          <p className="text-sm text-gray-500">資産総額</p>
        </div>
        <p className="text-lg font-bold text-[#c47c2b]">¥{formatJPY(totalAssets)}</p>
      </div>

      {/* 期限間近の優待（1ヶ月以内） */}
      <div className="bg-white rounded-2xl shadow-sm border border-black/5 p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-gray-800">期限間近の優待</h2>
          <Link to="/yutai" className="text-xs text-[#2d5f3f] font-medium">すべて見る →</Link>
        </div>
        {expiringStocks.length === 0 ? (
          <p className="text-sm text-gray-400 py-6 text-center">1ヶ月以内に期限を迎える優待はありません</p>
        ) : (
          <div className="space-y-3">
            {expiringStocks.map((s) => {
              const urgentClass = s.dl <= 7
                ? 'text-[#b83232] bg-[#fbeaea]'
                : 'text-[#c47c2b] bg-[#faf0e2]';
              return (
                <div key={s.id} className="flex items-center gap-3 py-1">
                  {s.photo ? (
                    <div className="w-11 h-11 rounded-xl overflow-hidden flex-shrink-0">
                      <img src={s.photo} alt={s.name} className="w-full h-full object-cover" />
                    </div>
                  ) : (
                    <div className="w-11 h-11 rounded-xl bg-gray-100 flex-shrink-0 flex items-center justify-center">
                      <svg viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="1.5" className="w-5 h-5">
                        <rect x="2" y="3" width="20" height="14" rx="2" />
                        <path d="M8 21h8M12 17v4" />
                      </svg>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800 truncate">{s.name}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{s.expiry}</p>
                  </div>
                  <span className={`text-xs font-bold px-2.5 py-1 rounded-full flex-shrink-0 ${urgentClass}`}>
                    残{s.dl}日
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
