import React, { useState, useEffect, useCallback } from 'react';
import { db } from '../firebase.js';
import {
  collection, onSnapshot, getDocs, setDoc, doc,
  serverTimestamp, query, where,
} from 'firebase/firestore';

const EXPENSE_CATEGORIES = ['食費', '外食', '日用品', '交通費', '娯楽', '医療', '教育', '住居', '光熱費', '通信費', '服飾', 'その他'];

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

function prevMonth(yyyymm) {
  const [y, m] = yyyymm.split('-').map(Number);
  const d = new Date(y, m - 2);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function nextMonthStr(yyyymm) {
  const [y, m] = yyyymm.split('-').map(Number);
  const d = new Date(y, m);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function Budget() {
  const [month, setMonth] = useState(getCurrentMonth());
  const [budgets, setBudgets] = useState({}); // { category: amount }
  const [actuals, setActuals] = useState({}); // { category: amount }
  const [editValues, setEditValues] = useState({});
  const [saving, setSaving] = useState({});
  const [loading, setLoading] = useState(true);

  // Load budgets for selected month
  useEffect(() => {
    setLoading(true);
    const unsub = onSnapshot(
      query(collection(db, 'budgets'), where('month', '==', month)),
      (snap) => {
        const b = {};
        snap.docs.forEach((d) => {
          const data = d.data();
          b[data.category] = data.amount || 0;
        });
        setBudgets(b);
        setEditValues(
          EXPENSE_CATEGORIES.reduce((acc, cat) => {
            acc[cat] = String(b[cat] || '');
            return acc;
          }, {})
        );
        setLoading(false);
      },
      () => { setLoading(false); }
    );
    return unsub;
  }, [month]);

  // Load actuals (transactions) for selected month
  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'transactions'), where('type', '==', 'expense')),
      (snap) => {
        const a = {};
        snap.docs.forEach((d) => {
          const data = d.data();
          if (data.date && data.date.startsWith(month)) {
            a[data.category] = (a[data.category] || 0) + (data.amount || 0);
          }
        });
        setActuals(a);
      },
      () => {}
    );
    return unsub;
  }, [month]);

  const saveBudget = useCallback(async (category) => {
    const val = Number(editValues[category]);
    if (isNaN(val) || val < 0) return;
    setSaving((s) => ({ ...s, [category]: true }));
    try {
      const docId = `${month}_${category}`;
      await setDoc(doc(db, 'budgets', docId), {
        month,
        category,
        amount: val,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      console.error(err);
      alert('保存に失敗しました');
    } finally {
      setSaving((s) => ({ ...s, [category]: false }));
    }
  }, [month, editValues]);

  const totalBudget = EXPENSE_CATEGORIES.reduce((s, c) => s + (budgets[c] || 0), 0);
  const totalActual = EXPENSE_CATEGORIES.reduce((s, c) => s + (actuals[c] || 0), 0);
  const totalPct = totalBudget > 0 ? Math.round((totalActual / totalBudget) * 100) : 0;

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <div className="mb-4">
        <h1 className="text-base font-bold text-gray-800">予算管理</h1>
      </div>

      {/* Month navigator */}
      <div className="flex items-center justify-between bg-white rounded-2xl shadow-sm border border-black/5 px-4 py-3 mb-4">
        <button
          onClick={() => setMonth(prevMonth(month))}
          className="w-8 h-8 flex items-center justify-center rounded-lg border border-black/10 text-gray-500 hover:bg-gray-50 transition-colors"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <span className="font-bold text-gray-800">{getMonthLabel(month)}</span>
        <button
          onClick={() => setMonth(nextMonthStr(month))}
          className="w-8 h-8 flex items-center justify-center rounded-lg border border-black/10 text-gray-500 hover:bg-gray-50 transition-colors"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>

      {/* Total summary */}
      <div className="bg-white rounded-2xl shadow-sm border border-black/5 p-4 mb-4">
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm text-gray-600">合計予算</span>
          <span className="font-bold text-gray-800">¥{formatJPY(totalBudget)}</span>
        </div>
        <div className="flex justify-between items-center mb-3">
          <span className="text-sm text-gray-600">合計支出</span>
          <span className={`font-bold ${totalActual > totalBudget ? 'text-[#b83232]' : 'text-[#2d5f3f]'}`}>
            ¥{formatJPY(totalActual)}
          </span>
        </div>
        {totalBudget > 0 && (
          <>
            <div className="flex justify-between text-xs text-gray-400 mb-1">
              <span>使用率</span>
              <span>{totalPct}%</span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  totalPct > 100 ? 'bg-[#b83232]' : totalPct > 80 ? 'bg-yellow-400' : 'bg-[#2d5f3f]'
                }`}
                style={{ width: `${Math.min(totalPct, 100)}%` }}
              />
            </div>
          </>
        )}
      </div>

      {/* Categories */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-7 h-7 border-2 border-gray-200 border-t-[#2d5f3f] rounded-full animate-spin-custom" />
        </div>
      ) : (
        <div className="space-y-3">
          {EXPENSE_CATEGORIES.map((cat) => {
            const budget = budgets[cat] || 0;
            const actual = actuals[cat] || 0;
            const pct = budget > 0 ? Math.round((actual / budget) * 100) : 0;
            const barColor =
              pct > 100 ? 'bg-[#b83232]' : pct > 80 ? 'bg-yellow-400' : 'bg-[#2d5f3f]';
            const overBudget = budget > 0 && actual > budget;

            return (
              <div key={cat} className="bg-white rounded-2xl shadow-sm border border-black/5 p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-800">{cat}</span>
                  <div className="flex items-center gap-1.5">
                    {overBudget && (
                      <span className="text-xs text-[#b83232] font-medium">超過</span>
                    )}
                    {budget > 0 && (
                      <span className={`text-xs font-bold ${pct > 100 ? 'text-[#b83232]' : pct > 80 ? 'text-yellow-600' : 'text-[#2d5f3f]'}`}>
                        {pct}%
                      </span>
                    )}
                  </div>
                </div>

                {/* Progress bar */}
                {budget > 0 && (
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mb-3">
                    <div
                      className={`h-full ${barColor} rounded-full transition-all`}
                      style={{ width: `${Math.min(pct, 100)}%` }}
                    />
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <p className="text-xs text-gray-400 mb-1">予算</p>
                    <div className="relative">
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs">¥</span>
                      <input
                        type="number"
                        min="0"
                        value={editValues[cat] ?? ''}
                        onChange={(e) =>
                          setEditValues((prev) => ({ ...prev, [cat]: e.target.value }))
                        }
                        onBlur={() => saveBudget(cat)}
                        placeholder="0"
                        className="w-full pl-6 pr-2 py-1.5 text-sm border border-black/15 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2d5f3f]"
                      />
                    </div>
                  </div>
                  <div className="flex-1">
                    <p className="text-xs text-gray-400 mb-1">実績</p>
                    <p className={`text-sm font-bold py-1.5 ${actual > 0 ? 'text-gray-800' : 'text-gray-300'}`}>
                      ¥{formatJPY(actual)}
                    </p>
                  </div>
                  <div className="flex-shrink-0">
                    <button
                      onClick={() => saveBudget(cat)}
                      disabled={saving[cat]}
                      className="mt-5 px-3 py-1.5 bg-[#2d5f3f] text-white rounded-lg text-xs font-medium disabled:opacity-50 hover:bg-[#24502f] transition-colors"
                    >
                      {saving[cat] ? '…' : '保存'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
