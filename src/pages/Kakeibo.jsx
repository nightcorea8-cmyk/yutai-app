import React, { useState, useEffect, useCallback } from 'react';
import { db } from '../firebase.js';
import {
  collection, onSnapshot, addDoc, deleteDoc, doc,
  serverTimestamp, query, orderBy,
} from 'firebase/firestore';

const INCOME_CATEGORIES = ['給与', 'ボーナス', '副収入', 'その他'];
const EXPENSE_CATEGORIES = ['食費', '外食', '日用品', '交通費', '娯楽', '医療', '教育', '住居', '光熱費', '通信費', '服飾', 'その他'];
const USERS = ['ひゅうご', 'なる'];

function formatJPY(n) {
  return new Intl.NumberFormat('ja-JP').format(Math.abs(n));
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getMonthLabel(yyyymm) {
  const [y, m] = yyyymm.split('-');
  return `${y}年${parseInt(m, 10)}月`;
}

export default function Kakeibo() {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);

  // Form state
  const [txType, setTxType] = useState('expense');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('食費');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(todayStr());
  const [submitting, setSubmitting] = useState(false);

  // User selection (persisted)
  const [selectedUser, setSelectedUser] = useState(
    () => localStorage.getItem('selectedUser') || 'ひゅうご'
  );

  // Filter / view
  const [viewMonth, setViewMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

  useEffect(() => {
    const q = query(collection(db, 'transactions'), orderBy('date', 'desc'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      setTransactions(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }, () => { setLoading(false); });
    return unsub;
  }, []);

  useEffect(() => {
    localStorage.setItem('selectedUser', selectedUser);
  }, [selectedUser]);

  // Reset category when type changes
  useEffect(() => {
    setCategory(txType === 'income' ? '給与' : '食費');
  }, [txType]);

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) return;
    setSubmitting(true);
    try {
      await addDoc(collection(db, 'transactions'), {
        type: txType,
        amount: Number(amount),
        category,
        description: description.trim(),
        date,
        addedBy: selectedUser,
        createdAt: serverTimestamp(),
      });
      setAmount('');
      setDescription('');
      setDate(todayStr());
    } catch (err) {
      console.error(err);
      alert('保存に失敗しました');
    } finally {
      setSubmitting(false);
    }
  }, [txType, amount, category, description, date, selectedUser]);

  const handleDelete = useCallback(async (id) => {
    if (!confirm('この記録を削除しますか？')) return;
    try {
      await deleteDoc(doc(db, 'transactions', id));
    } catch {
      alert('削除に失敗しました');
    }
  }, []);

  // Group by month
  const availableMonths = [...new Set(
    transactions.map((t) => t.date?.slice(0, 7)).filter(Boolean)
  )].sort((a, b) => b.localeCompare(a));

  if (!availableMonths.includes(viewMonth) && availableMonths.length > 0) {
    // keep viewMonth as is (may be current month with no tx)
  }

  const monthTx = transactions.filter((t) => t.date?.startsWith(viewMonth));
  const monthIncome = monthTx.filter((t) => t.type === 'income').reduce((s, t) => s + (t.amount || 0), 0);
  const monthExpense = monthTx.filter((t) => t.type === 'expense').reduce((s, t) => s + (t.amount || 0), 0);
  const monthBalance = monthIncome - monthExpense;

  // Group by date within month
  const byDate = {};
  monthTx.forEach((t) => {
    const d = t.date || '未分類';
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(t);
  });
  const sortedDates = Object.keys(byDate).sort((a, b) => b.localeCompare(a));

  const categories = txType === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;

  return (
    <div className="p-5 max-w-2xl mx-auto">
      <div className="mb-5">
        <h1 className="text-lg font-bold text-gray-800">家計簿</h1>
      </div>

      {/* User selector */}
      <div className="bg-white rounded-2xl shadow-sm border border-black/5 p-4 mb-5 flex items-center gap-3">
        <span className="text-sm text-gray-500 flex-shrink-0">入力者</span>
        <div className="flex gap-2">
          {USERS.map((u) => (
            <button
              key={u}
              onClick={() => setSelectedUser(u)}
              className={`px-5 py-2 rounded-full text-sm font-medium transition-colors ${
                selectedUser === u
                  ? 'bg-[#2d5f3f] text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {u}
            </button>
          ))}
        </div>
      </div>

      {/* Quick Add Form */}
      <div className="bg-white rounded-2xl shadow-sm border border-black/5 p-5 mb-5">
        <h2 className="text-sm font-bold text-gray-800 mb-4">収支を追加</h2>
        <form onSubmit={handleSubmit}>
          {/* Type toggle */}
          <div className="flex rounded-xl overflow-hidden border border-black/10 mb-4">
            <button
              type="button"
              onClick={() => setTxType('expense')}
              className={`flex-1 py-3 text-sm font-semibold transition-colors ${
                txType === 'expense' ? 'bg-[#b83232] text-white' : 'bg-gray-50 text-gray-500'
              }`}
            >
              支出
            </button>
            <button
              type="button"
              onClick={() => setTxType('income')}
              className={`flex-1 py-3 text-sm font-semibold transition-colors ${
                txType === 'income' ? 'bg-[#2d5f3f] text-white' : 'bg-gray-50 text-gray-500'
              }`}
            >
              収入
            </button>
          </div>

          {/* Amount */}
          <div className="mb-4">
            <label className="block text-sm text-gray-500 mb-1.5 font-medium">金額 *</label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-bold text-lg">¥</span>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                min="1"
                required
                className="w-full pl-9 pr-4 py-3.5 text-xl font-bold border border-black/15 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#2d5f3f] focus:ring-offset-0"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-4">
            {/* Category */}
            <div>
              <label className="block text-sm text-gray-500 mb-1.5 font-medium">カテゴリ</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full px-3 py-3 text-sm border border-black/15 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#2d5f3f] bg-white"
              >
                {categories.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            {/* Date */}
            <div>
              <label className="block text-sm text-gray-500 mb-1.5 font-medium">日付</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
                className="w-full px-3 py-3 text-sm border border-black/15 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#2d5f3f]"
              />
            </div>
          </div>

          {/* Description */}
          <div className="mb-4">
            <label className="block text-sm text-gray-500 mb-1.5 font-medium">メモ（任意）</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="例：スーパーで買い物"
              className="w-full px-4 py-3 text-sm border border-black/15 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#2d5f3f]"
            />
          </div>

          <button
            type="submit"
            disabled={submitting || !amount}
            className="w-full py-3.5 bg-[#2d5f3f] text-white rounded-xl font-semibold text-base disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#24502f] transition-colors"
          >
            {submitting ? '保存中…' : '追加する'}
          </button>
        </form>
      </div>

      {/* Month selector */}
      <div className="flex items-center gap-2 mb-3 overflow-x-auto scrollbar-none pb-1">
        {/* Always include current month */}
        {[...new Set([viewMonth, ...availableMonths])].slice(0, 6).map((m) => (
          <button
            key={m}
            onClick={() => setViewMonth(m)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium flex-shrink-0 transition-colors ${
              viewMonth === m
                ? 'bg-[#2d5f3f] text-white'
                : 'bg-white text-gray-600 border border-black/10 hover:bg-gray-50'
            }`}
          >
            {getMonthLabel(m)}
          </button>
        ))}
      </div>

      {/* Monthly summary */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        {[
          { label: '収入', value: monthIncome, color: 'text-[#2d5f3f]' },
          { label: '支出', value: monthExpense, color: 'text-[#b83232]' },
          { label: '収支', value: monthBalance, color: monthBalance >= 0 ? 'text-[#2d5f3f]' : 'text-[#b83232]' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-white rounded-xl border border-black/5 shadow-sm p-4">
            <p className="text-xs text-gray-400 mb-2">{label}</p>
            <p className={`text-lg font-bold ${color} leading-tight`}>
              {value < 0 ? '-' : label === '収支' && value > 0 ? '+' : ''}¥{formatJPY(value)}
            </p>
          </div>
        ))}
      </div>

      {/* Transaction list */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-7 h-7 border-2 border-gray-200 border-t-[#2d5f3f] rounded-full animate-spin-custom" />
        </div>
      ) : monthTx.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-12 h-12 mx-auto mb-3 text-gray-300">
            <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <p className="text-sm">この月の記録はありません</p>
        </div>
      ) : (
        <div className="space-y-5">
          {sortedDates.map((dateKey) => (
            <div key={dateKey}>
              <div className="text-xs font-bold text-gray-400 mb-3 px-1">
                {dateKey.replace(/-/g, '/')}
              </div>
              <div className="space-y-2">
                {byDate[dateKey].map((t) => (
                  <div
                    key={t.id}
                    className="bg-white rounded-2xl border border-black/5 shadow-sm px-4 py-4 flex items-center gap-3"
                  >
                    <div
                      className={`w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center ${
                        t.type === 'income' ? 'bg-[#e8f0eb]' : 'bg-[#fbeaea]'
                      }`}
                    >
                      {t.type === 'income' ? (
                        <svg viewBox="0 0 24 24" fill="none" stroke="#2d5f3f" strokeWidth="2" className="w-5 h-5">
                          <path d="M12 19V5M5 12l7-7 7 7" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" fill="none" stroke="#b83232" strokeWidth="2" className="w-5 h-5">
                          <path d="M12 5v14M19 12l-7 7-7-7" />
                        </svg>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-sm font-semibold text-gray-700">{t.category}</span>
                        {t.addedBy && (
                          <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                            {t.addedBy}
                          </span>
                        )}
                      </div>
                      {t.description && (
                        <p className="text-xs text-gray-400 truncate mt-1">{t.description}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span
                        className={`text-base font-bold ${
                          t.type === 'income' ? 'text-[#2d5f3f]' : 'text-[#b83232]'
                        }`}
                      >
                        {t.type === 'income' ? '+' : '-'}¥{formatJPY(t.amount)}
                      </span>
                      <button
                        onClick={() => handleDelete(t.id)}
                        className="text-gray-300 hover:text-[#b83232] transition-colors p-2"
                        aria-label="削除"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6l-1 14H6L5 6M10 11v6M14 11v6M9 6V4h6v2" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
