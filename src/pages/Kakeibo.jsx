import React, { useState, useEffect, useCallback, useRef } from 'react';
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

// Auto-categorize based on merchant name (half-width kana patterns from card CSV)
function guessCategoryFromMerchant(name) {
  const n = name.toLowerCase();
  if (/ｽ-ﾊﾟ|ｲｵﾝ|西友|ｾｲﾕ|ｺ-ｵﾌﾟ|ｺ-ﾌﾟ|ｵｵｻﾞﾑ|ﾗｲﾌ|食料|食材/.test(n)) return '食費';
  if (/ﾏｸﾄﾞ|ｹﾝﾀｯｷ|ｽｶｲﾗ|ｻｲｾﾞﾘﾔ|ｸﾞﾙﾒ|ﾚｽﾄﾗﾝ|居酒屋|ﾗｰﾒﾝ|ｿﾊﾞ|ｽｼ|焼肉|ﾋﾟｻﾞ|外食|飲食/.test(n)) return '外食';
  if (/ｺｰﾅﾝ|ﾆﾄﾘ|ﾀﾞｲｿ|ﾔﾏﾀﾞ|ﾋﾞﾚｯｼﾞ|ｶｲﾝｽﾞ|ﾐﾆｽﾄｯﾌﾟ|ﾛｰｿﾝ|ｾﾌﾞﾝ|ﾌｧﾐﾘ|薬|ﾔｸ|ﾏﾂﾓﾄｷﾖｼ|ｳﾞｨﾚｯｼﾞ/.test(n)) return '日用品';
  if (/ｲﾃﾞﾐﾂ|ｴﾈｵｽ|ｺｽﾓ|ｼｪﾙ|ＥＴＣ|etc|ｵｰﾄﾊﾞｯｸｽ|ﾄﾖﾀ|ﾆｯｻﾝ|ﾎﾝﾀﾞ|電車|ﾊﾞｽ|駅|新幹線|高速|駐車/.test(n)) return '交通費';
  if (/ﾈｯﾄﾌﾘｯｸｽ|netflix|youtube|ｱﾏｿﾞﾝ|amazon|ｸﾞｰｸﾞﾙ|google|ｽﾎﾟﾃｨ|spotify|ﾃﾞｨｽﾆ|disney|映画|ｶﾗｵｹ|遊園|ゲーム|ﾕｰﾁｭ/.test(n)) return '娯楽';
  if (/病院|ｸﾘﾆｯｸ|薬局|ﾄﾞﾗｯｸﾞ|医院|歯科|ﾋﾞﾖｳｲﾝ|調剤/.test(n)) return '医療';
  if (/学校|塾|ｽｸｰﾙ|教育|保育|幼稚|習い事|本|図書/.test(n)) return '教育';
  if (/電力|ﾃﾞﾝﾘﾖｸ|ガス|ｶﾞｽ|水道/.test(n)) return '光熱費';
  if (/通信|ﾄﾞｺﾓ|au|ｿﾌﾄﾊﾞﾝｸ|ﾗｸﾃﾝ携帯|ｲﾝﾀｰﾈｯﾄ|wifi/.test(n)) return '通信費';
  if (/ﾕﾆｸﾛ|ｼﾞｰﾕｰ|洋服|ﾌｧｯｼｮﾝ|ｱﾊﾟﾚﾙ|服/.test(n)) return '服飾';
  return 'その他';
}

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

function parseCardCSV(text) {
  const lines = text.split(/\r?\n/);
  const rows = [];
  let headerFound = false;
  let colDate = 0, colName = 1, colUser = 2, colAmount = 4;

  for (const line of lines) {
    if (!line.trim()) continue;
    const cols = parseCSVLine(line);
    if (!headerFound) {
      const idx = cols.findIndex((c) => c.includes('利用日'));
      if (idx >= 0) {
        headerFound = true;
        colDate = cols.findIndex((c) => c.includes('利用日'));
        colName = cols.findIndex((c) => c.includes('利用店名') || c.includes('商品名'));
        colUser = cols.findIndex((c) => c.includes('利用者'));
        colAmount = cols.findIndex((c) => c.includes('利用金額'));
        if (colName < 0) colName = 1;
        if (colUser < 0) colUser = 2;
        if (colAmount < 0) colAmount = 4;
      }
      continue;
    }

    const rawDate = cols[colDate] || '';
    const rawAmount = cols[colAmount] || '';
    if (!/^\d{4}\/\d{2}\/\d{2}$/.test(rawDate)) continue;
    const amount = parseInt(rawAmount.replace(/,/g, ''), 10);
    if (!amount || amount <= 0) continue;

    const date = rawDate.replace(/\//g, '-');
    const merchant = (cols[colName] || '').trim();
    const rawUser = cols[colUser] || '';
    const addedBy = rawUser === '家族' ? 'なる' : 'ひゅうご';

    rows.push({ date, merchant, addedBy, amount, category: guessCategoryFromMerchant(merchant), selected: true });
  }
  return rows;
}

async function readFileAsText(file) {
  const buffer = await file.arrayBuffer();
  for (const enc of ['shift-jis', 'utf-8']) {
    try {
      const text = new TextDecoder(enc).decode(buffer);
      if (text.includes('利用日') || text.includes('利用金額')) return text;
    } catch {}
  }
  return new TextDecoder('utf-8').decode(buffer);
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

  // CSV import state
  const [csvRows, setCsvRows] = useState(null);
  const [csvImporting, setCsvImporting] = useState(false);
  const [csvError, setCsvError] = useState('');
  const [importToast, setImportToast] = useState(''); // success message
  const fileInputRef = useRef(null);

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

  // CSV handlers
  const handleFileSelect = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setCsvError('');
    try {
      const text = await readFileAsText(file);
      const rows = parseCardCSV(text);
      if (rows.length === 0) {
        setCsvError('有効なデータが見つかりませんでした。カード明細のCSVファイルを選択してください。');
        return;
      }
      setCsvRows(rows);
    } catch (err) {
      console.error(err);
      setCsvError('ファイルの読み込みに失敗しました。');
    }
  }, []);

  const toggleCsvRow = useCallback((idx) => {
    setCsvRows((rows) => rows.map((r, i) => i === idx ? { ...r, selected: !r.selected } : r));
  }, []);

  const updateCsvCategory = useCallback((idx, cat) => {
    setCsvRows((rows) => rows.map((r, i) => i === idx ? { ...r, category: cat } : r));
  }, []);

  const handleCsvImport = useCallback(async () => {
    const toImport = csvRows.filter((r) => r.selected);
    if (toImport.length === 0) return;
    setCsvImporting(true);
    try {
      // Sequential writes to avoid Firestore rate limits
      for (const r of toImport) {
        await addDoc(collection(db, 'transactions'), {
          type: 'expense',
          amount: r.amount,
          category: r.category,
          description: r.merchant,
          date: r.date,
          addedBy: r.addedBy,
          createdAt: serverTimestamp(),
        });
      }
      const importedMonth = toImport[0]?.date?.slice(0, 7) || viewMonth;
      setCsvRows(null);
      setViewMonth(importedMonth);
      setImportToast(`${toImport.length}件をインポートしました（${getMonthLabel(importedMonth)}）`);
      setTimeout(() => setImportToast(''), 5000);
    } catch (err) {
      console.error('CSV import error:', err);
      alert(`インポートに失敗しました\n\nエラー: ${err.message || err}`);
    } finally {
      setCsvImporting(false);
    }
  }, [csvRows, viewMonth]);

  // Group by month
  const availableMonths = [...new Set(
    transactions.map((t) => t.date?.slice(0, 7)).filter(Boolean)
  )].sort((a, b) => b.localeCompare(a));

  const monthTx = transactions.filter((t) => t.date?.startsWith(viewMonth));
  const monthIncome = monthTx.filter((t) => t.type === 'income').reduce((s, t) => s + (t.amount || 0), 0);
  const monthExpense = monthTx.filter((t) => t.type === 'expense').reduce((s, t) => s + (t.amount || 0), 0);
  const monthBalance = monthIncome - monthExpense;

  const byDate = {};
  monthTx.forEach((t) => {
    const d = t.date || '未分類';
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(t);
  });
  const sortedDates = Object.keys(byDate).sort((a, b) => b.localeCompare(a));

  const categories = txType === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  const selectedCount = csvRows ? csvRows.filter((r) => r.selected).length : 0;

  return (
    <div className="p-5 max-w-2xl mx-auto">
      {/* Import success toast */}
      {importToast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-[#2d5f3f] text-white text-sm font-medium px-5 py-3 rounded-2xl shadow-lg flex items-center gap-2 whitespace-nowrap">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-4 h-4 flex-shrink-0">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          {importToast}
        </div>
      )}

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

      {/* CSV Import button */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv"
        className="hidden"
        onChange={handleFileSelect}
      />
      <button
        onClick={() => fileInputRef.current?.click()}
        className="w-full py-3.5 bg-white border-2 border-dashed border-[#2d5f3f]/40 text-[#2d5f3f] rounded-xl font-semibold text-sm hover:bg-[#2d5f3f]/5 transition-colors mb-2 flex items-center justify-center gap-2"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" />
        </svg>
        カード明細CSVをインポート
      </button>
      {csvError && (
        <p className="text-xs text-[#b83232] text-center mb-3">{csvError}</p>
      )}
      {!csvError && <div className="mb-4" />}

      {/* Quick Add Form */}
      <div className="bg-white rounded-2xl shadow-sm border border-black/5 p-5 mb-5">
        <h2 className="text-sm font-bold text-gray-800 mb-4">手動で追加</h2>
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

      {/* CSV Preview Modal */}
      {csvRows && (
        <div className="fixed inset-0 z-50 flex flex-col bg-[#f5f0eb]">
          {/* Header */}
          <div className="bg-white border-b border-black/5 px-5 py-4 flex items-center gap-3 flex-shrink-0">
            <button
              onClick={() => setCsvRows(null)}
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-black/10 text-gray-500"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                <path d="M19 12H5M12 5l-7 7 7 7" />
              </svg>
            </button>
            <div className="flex-1">
              <h2 className="text-sm font-bold text-gray-800">CSVインポート確認</h2>
              <p className="text-xs text-gray-400">{csvRows.length}件のデータ · {selectedCount}件選択中</p>
            </div>
            <button
              onClick={() => setCsvRows((rows) => rows.map((r) => ({ ...r, selected: true })))}
              className="text-xs text-[#2d5f3f] font-medium px-3 py-1 rounded-lg border border-[#2d5f3f]/20"
            >
              全選択
            </button>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
            {csvRows.map((row, idx) => (
              <div
                key={idx}
                className={`bg-white rounded-2xl border px-4 py-3.5 transition-opacity ${
                  row.selected ? 'border-black/5 shadow-sm' : 'border-black/5 opacity-40'
                }`}
              >
                <div className="flex items-start gap-3">
                  {/* Checkbox */}
                  <button
                    onClick={() => toggleCsvRow(idx)}
                    className={`w-5 h-5 rounded-md border-2 flex-shrink-0 mt-0.5 flex items-center justify-center transition-colors ${
                      row.selected ? 'bg-[#2d5f3f] border-[#2d5f3f]' : 'border-gray-300 bg-white'
                    }`}
                  >
                    {row.selected && (
                      <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" className="w-3 h-3">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </button>

                  <div className="flex-1 min-w-0">
                    {/* Date + user + amount */}
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-400">{row.date.replace(/-/g, '/')}</span>
                        <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{row.addedBy}</span>
                      </div>
                      <span className="text-base font-bold text-[#b83232]">¥{formatJPY(row.amount)}</span>
                    </div>

                    {/* Merchant */}
                    <p className="text-sm font-medium text-gray-700 truncate mb-2">{row.merchant}</p>

                    {/* Category selector */}
                    <select
                      value={row.category}
                      onChange={(e) => updateCsvCategory(idx, e.target.value)}
                      disabled={!row.selected}
                      className="w-full px-3 py-2 text-xs border border-black/10 rounded-xl bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#2d5f3f]"
                    >
                      {EXPENSE_CATEGORIES.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="bg-white border-t border-black/5 px-5 py-4 flex-shrink-0">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-gray-500">インポート合計</span>
              <span className="text-lg font-bold text-[#b83232]">
                ¥{formatJPY(csvRows.filter((r) => r.selected).reduce((s, r) => s + r.amount, 0))}
              </span>
            </div>
            <button
              onClick={handleCsvImport}
              disabled={csvImporting || selectedCount === 0}
              className="w-full py-3.5 bg-[#2d5f3f] text-white rounded-xl font-semibold text-base disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#24502f] transition-colors"
            >
              {csvImporting ? 'インポート中…' : `${selectedCount}件をインポート`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
