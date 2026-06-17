import React, { useState, useEffect, useCallback, useRef } from 'react';
import { db } from '../firebase.js';
import {
  collection, onSnapshot, addDoc, deleteDoc, updateDoc,
  doc, serverTimestamp, query, orderBy,
} from 'firebase/firestore';

const INCOME_CATEGORIES = ['給与', 'ボーナス', '振込', '副収入', 'その他'];
const EXPENSE_CATEGORIES = ['食費', '外食', '日用品', '交通費', '娯楽', '医療', '教育', '住居', '光熱費', '通信費', '服飾', '保険', '税金', 'その他'];
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

function shiftMonth(yyyymm, delta) {
  const [y, m] = yyyymm.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
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

async function readFileAsText(file) {
  const buffer = await file.arrayBuffer();
  const jpRe = /[　-鿿＀-￯]/;
  // UTF-8を先に試す（fatal:trueで不正バイト列は即失敗）
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    if (jpRe.test(text)) return text;
  } catch {}
  // Shift-JISを試す（楽天銀行などの口座明細）
  try {
    const text = new TextDecoder('shift-jis').decode(buffer);
    if (jpRe.test(text)) return text;
  } catch {}
  return new TextDecoder('utf-8').decode(buffer);
}

// 口座明細パーサー: 取引日(YYYYMMDD), 入出金(円), 残高(円), 入出金内容
function parseBankCSV(text) {
  const lines = text.split(/\r?\n/);
  const rows = [];
  let headerFound = false;

  for (const line of lines) {
    if (!line.trim()) continue;
    const cols = parseCSVLine(line);

    if (!headerFound) {
      if (cols.some((c) => c.includes('取引日') || c.includes('入出金'))) headerFound = true;
      continue;
    }

    const rawDate = (cols[0] || '').replace(/\//g, '').replace(/-/g, '');
    const rawAmount = cols[1] || '';
    const description = (cols[3] || cols[2] || '').trim();

    if (!/^\d{8}$/.test(rawDate)) continue;
    const amount = parseInt(rawAmount.replace(/,/g, ''), 10);
    if (isNaN(amount) || amount === 0) continue;

    const date = `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`;
    const isExpense = amount < 0;
    const absAmount = Math.abs(amount);
    // カード払いを検出（ーｰ－−-など様々なダッシュ文字に対応）
    const isCardPayment = /カ[ーｰ－−\-]ト゛?|カード|CARD/i.test(description);

    rows.push({
      date,
      description,
      amount: absAmount,
      type: isExpense ? 'expense' : 'income',
      category: 'その他',
      isCardPayment,
      selected: true,
    });
  }
  return rows;
}

// カード明細パーサー: 利用日, 利用店名, 利用者, 支払方法, 利用金額, ...
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
    if (!/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(rawDate)) continue;
    const amount = parseInt(rawAmount.replace(/,/g, ''), 10);
    if (!amount || amount <= 0) continue;

    const [dy, dm, dd] = rawDate.split('/');
    const date = `${dy}-${dm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
    const merchant = (cols[colName] || '').trim();
    const rawUser = cols[colUser] || '';
    const addedBy = rawUser === '家族' ? 'なる' : 'ひゅうご';

    rows.push({ date, merchant, addedBy, amount, category: 'その他', selected: true });
  }
  return rows;
}

export default function Kakeibo() {
  const [transactions, setTransactions] = useState([]);
  const [cardStatements, setCardStatements] = useState([]);
  const [loading, setLoading] = useState(true);

  // 手動入力フォーム
  const [showManualForm, setShowManualForm] = useState(false);
  const [txType, setTxType] = useState('expense');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('その他');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(todayStr());
  const [submitting, setSubmitting] = useState(false);

  const [selectedUser, setSelectedUser] = useState(
    () => localStorage.getItem('selectedUser') || 'ひゅうご'
  );

  const [viewMonth, setViewMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

  // CSV
  const [bankCsvRows, setBankCsvRows] = useState(null);
  const [cardCsvRows, setCardCsvRows] = useState(null);
  const [csvImporting, setCsvImporting] = useState(false);
  const [csvError, setCsvError] = useState('');
  const [importToast, setImportToast] = useState('');

  // ドリルダウン
  const [expandedTxId, setExpandedTxId] = useState(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const bankFileRef = useRef(null);
  const cardFileRef = useRef(null);

  // 口座ベースのトランザクション
  useEffect(() => {
    const q = query(collection(db, 'transactions'), orderBy('date', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setTransactions(docs);
      setLoading(false);
    }, (err) => {
      console.error('transactions fetch error:', err);
      setLoading(false);
    });
    return unsub;
  }, []);

  // カード明細（収支計算に含めない）
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'cardStatements'), (snap) => {
      setCardStatements(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    }, () => {});
    return unsub;
  }, []);

  useEffect(() => {
    localStorage.setItem('selectedUser', selectedUser);
  }, [selectedUser]);

  // 未リンクのカード明細と口座取引を自動再リンク
  const autoLinkedRef = useRef(false);
  useEffect(() => {
    if (loading || autoLinkedRef.current) return;
    if (cardStatements.length === 0 || transactions.length === 0) return;
    autoLinkedRef.current = true;
    const unlinked = cardStatements.filter((s) => !s.linkedTransactionId);
    if (unlinked.length === 0) return;
    unlinked.forEach(async (stmt) => {
      const match = transactions.find(
        (t) => t.source === 'bank' && t.type === 'expense' && t.amount === stmt.totalAmount && !t.cardStatementId
      );
      if (match) {
        await updateDoc(doc(db, 'cardStatements', stmt.id), { linkedTransactionId: match.id });
        await updateDoc(doc(db, 'transactions', match.id), { cardStatementId: stmt.id });
      }
    });
  }, [loading, cardStatements, transactions]); // eslint-disable-line react-hooks/exhaustive-deps

  // データロード後、表示月にデータがなければ最新データのある月へ自動移動
  useEffect(() => {
    if (loading || transactions.length === 0) return;
    const months = [...new Set(transactions.map((t) => t.date?.slice(0, 7)).filter(Boolean))].sort((a, b) => b.localeCompare(a));
    if (months.length > 0 && !transactions.some((t) => t.date?.startsWith(viewMonth))) {
      setViewMonth(months[0]);
    }
  }, [loading, transactions]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setCategory(txType === 'income' ? '給与' : 'その他');
  }, [txType]);

  // 手動入力
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
        source: 'manual',
        createdAt: serverTimestamp(),
      });
      setAmount('');
      setDescription('');
      setDate(todayStr());
      setShowManualForm(false);
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

  // 口座CSVファイル選択
  const handleBankFile = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setCsvError('');
    try {
      const text = await readFileAsText(file);
      const rows = parseBankCSV(text);
      if (rows.length === 0) {
        setCsvError('有効なデータが見つかりません。口座明細のCSVを選択してください。');
        return;
      }
      // 重複チェック（同じ日付・金額・摘要がすでにある行はデフォルト非選択）
      const marked = rows.map((r) => {
        const dup = transactions.some(
          (t) => t.source === 'bank' && t.date === r.date && t.amount === r.amount && t.description === r.description
        );
        return { ...r, isDuplicate: dup, selected: !dup };
      });
      setBankCsvRows(marked);
    } catch (err) {
      console.error(err);
      setCsvError('ファイルの読み込みに失敗しました。');
    }
  }, [transactions]);

  // 口座CSVインポート実行
  const handleBankImport = useCallback(async () => {
    const toImport = bankCsvRows.filter((r) => r.selected);
    if (!toImport.length) return;
    setCsvImporting(true);
    try {
      for (const r of toImport) {
        const txRef = await addDoc(collection(db, 'transactions'), {
          type: r.type,
          amount: r.amount,
          category: r.category,
          description: r.description,
          date: r.date,
          addedBy: selectedUser,
          source: 'bank',
          isCardPayment: r.isCardPayment || false,
          excludeFromBalance: r.excludeFromBalance || false,
          createdAt: serverTimestamp(),
        });

        // 支出行：金額一致するカード明細と自動リンク
        if (r.type === 'expense') {
          const match = cardStatements.find(
            (s) => s.totalAmount === r.amount && !s.linkedTransactionId
          );
          if (match) {
            await updateDoc(doc(db, 'transactions', txRef.id), { cardStatementId: match.id });
            await updateDoc(doc(db, 'cardStatements', match.id), { linkedTransactionId: txRef.id });
          }
        }
      }

      const importedMonth = toImport[0]?.date?.slice(0, 7) || viewMonth;
      setBankCsvRows(null);
      setViewMonth(importedMonth);
      setImportToast(`${toImport.length}件をインポートしました（${getMonthLabel(importedMonth)}）`);
      setTimeout(() => setImportToast(''), 5000);
    } catch (err) {
      console.error('bank import error:', err);
      setCsvError(`インポートに失敗しました: ${err.message}`);
      setBankCsvRows(null);
    } finally {
      setCsvImporting(false);
    }
  }, [bankCsvRows, cardStatements, selectedUser, viewMonth]);

  // カードCSVファイル選択
  const handleCardFile = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setCsvError('');
    try {
      const text = await readFileAsText(file);
      const rows = parseCardCSV(text);
      if (rows.length === 0) {
        setCsvError('有効なデータが見つかりません。カード明細のCSVを選択してください。');
        return;
      }
      // 合計金額が一致する既存のカード明細があれば重複警告
      const total = rows.reduce((s, r) => s + r.amount, 0);
      const dup = cardStatements.some((s) => s.totalAmount === total);
      if (dup) {
        setCsvError(`この明細（合計 ¥${new Intl.NumberFormat('ja-JP').format(total)}）はすでにインポートされています。`);
        return;
      }
      setCardCsvRows(rows);
    } catch (err) {
      console.error(err);
      setCsvError('ファイルの読み込みに失敗しました。');
    }
  }, [cardStatements]);

  // カードCSVインポート実行（cardStatementsへ保存）
  const handleCardImport = useCallback(async () => {
    const toImport = cardCsvRows.filter((r) => r.selected);
    if (!toImport.length) return;
    setCsvImporting(true);
    try {
      const totalAmount = toImport.reduce((s, r) => s + r.amount, 0);
      const items = toImport.map((r) => ({
        date: r.date,
        merchant: r.merchant,
        amount: r.amount,
        category: r.category,
        addedBy: r.addedBy,
        excludeFromBalance: r.excludeFromBalance || false,
      }));

      const stmtRef = await addDoc(collection(db, 'cardStatements'), {
        totalAmount,
        items,
        linkedTransactionId: null,
        importedAt: serverTimestamp(),
      });

      // 金額一致する口座の支出行と自動リンク
      const match = transactions.find(
        (t) => t.source === 'bank' && t.type === 'expense' && t.amount === totalAmount && !t.cardStatementId
      );
      if (match) {
        await updateDoc(stmtRef, { linkedTransactionId: match.id });
        await updateDoc(doc(db, 'transactions', match.id), { cardStatementId: stmtRef.id });
      }

      setCardCsvRows(null);
      setImportToast(
        `カード明細${toImport.length}件をインポートしました${match ? '（口座と自動リンク済み）' : '（口座明細インポート後に自動リンクされます）'}`
      );
      setTimeout(() => setImportToast(''), 6000);
    } catch (err) {
      console.error('card import error:', err);
      setCsvError(`インポートに失敗しました: ${err.message}`);
      setCardCsvRows(null);
    } finally {
      setCsvImporting(false);
    }
  }, [cardCsvRows, transactions]);

  const handleToggleExclude = useCallback(async (id, currentValue) => {
    try {
      await updateDoc(doc(db, 'transactions', id), { excludeFromBalance: !currentValue });
    } catch (err) {
      console.error('toggle exclude error:', err);
    }
  }, []);

  const handleBulkDelete = useCallback(async () => {
    setShowDeleteConfirm(false);
    const toDelete = transactions.filter((t) => t.date?.startsWith(viewMonth));
    try {
      await Promise.all(toDelete.map((t) => deleteDoc(doc(db, 'transactions', t.id))));
    } catch (err) {
      console.error('bulk delete error:', err);
      alert('一括削除に失敗しました');
    }
  }, [transactions, viewMonth]);

  // リンク解除
  const handleUnlinkStatement = useCallback(async (txId, stmtId) => {
    try {
      await updateDoc(doc(db, 'transactions', txId), { cardStatementId: null });
      await updateDoc(doc(db, 'cardStatements', stmtId), { linkedTransactionId: null });
      setExpandedTxId(null);
    } catch (err) {
      console.error('unlink error:', err);
    }
  }, []);

  const toggleBankRow = useCallback((idx) => {
    setBankCsvRows((rows) => rows.map((r, i) => i === idx ? { ...r, selected: !r.selected } : r));
  }, []);
  const updateBankCategory = useCallback((idx, cat) => {
    setBankCsvRows((rows) => rows.map((r, i) => i === idx ? { ...r, category: cat } : r));
  }, []);
  const updateBankType = useCallback((idx, type) => {
    setBankCsvRows((rows) => rows.map((r, i) => i === idx ? { ...r, type, category: type === 'income' ? '給与' : 'その他' } : r));
  }, []);
  const toggleCardRow = useCallback((idx) => {
    setCardCsvRows((rows) => rows.map((r, i) => i === idx ? { ...r, selected: !r.selected } : r));
  }, []);
  const updateCardCategory = useCallback((idx, cat) => {
    setCardCsvRows((rows) => rows.map((r, i) => i === idx ? { ...r, category: cat } : r));
  }, []);
  const toggleBankExclude = useCallback((idx) => {
    setBankCsvRows((rows) => rows.map((r, i) => i === idx ? { ...r, excludeFromBalance: !r.excludeFromBalance } : r));
  }, []);
  const toggleCardExclude = useCallback((idx) => {
    setCardCsvRows((rows) => rows.map((r, i) => i === idx ? { ...r, excludeFromBalance: !r.excludeFromBalance } : r));
  }, []);

  const handleToggleCardItemExclude = useCallback(async (stmtId, itemIndex, currentValue) => {
    const stmt = cardStatements.find((s) => s.id === stmtId);
    if (!stmt) return;
    const newItems = (stmt.items || []).map((item, i) =>
      i === itemIndex ? { ...item, excludeFromBalance: !currentValue } : item
    );
    try {
      await updateDoc(doc(db, 'cardStatements', stmtId), { items: newItems });
    } catch (err) {
      console.error('toggle card item exclude error:', err);
    }
  }, [cardStatements]);

  // 月集計
  const availableMonths = [...new Set(
    transactions.map((t) => t.date?.slice(0, 7)).filter(Boolean)
  )].sort((a, b) => b.localeCompare(a));

  const monthTx = transactions.filter((t) => t.date?.startsWith(viewMonth));

  const getEffectiveAmount = (t) => {
    if (t.excludeFromBalance) return 0;
    const stmt = t.cardStatementId ? cardStatements.find((s) => s.id === t.cardStatementId) : null;
    if (stmt) {
      const excluded = (stmt.items || []).filter((i) => i.excludeFromBalance).reduce((s, i) => s + (i.amount || 0), 0);
      return Math.max(0, (t.amount || 0) - excluded);
    }
    return t.amount || 0;
  };

  const monthIncome = monthTx.filter((t) => t.type === 'income').reduce((s, t) => s + getEffectiveAmount(t), 0);
  const monthExpense = monthTx.filter((t) => t.type === 'expense').reduce((s, t) => s + getEffectiveAmount(t), 0);
  const monthBalance = monthIncome - monthExpense;

  const byDate = {};
  monthTx.forEach((t) => {
    const d = t.date || '未分類';
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(t);
  });
  const sortedDates = Object.keys(byDate).sort((a, b) => b.localeCompare(a));

  const bankSelectedCount = bankCsvRows?.filter((r) => r.selected).length || 0;
  const cardSelectedCount = cardCsvRows?.filter((r) => r.selected).length || 0;

  return (
    <div className="p-5 max-w-2xl mx-auto">
      {/* 成功トースト */}
      {importToast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-[#2d5f3f] text-white text-sm font-medium px-5 py-3 rounded-2xl shadow-lg flex items-center gap-2 max-w-xs text-center">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-4 h-4 flex-shrink-0">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          {importToast}
        </div>
      )}

      <div className="mb-5">
        <h1 className="text-lg font-bold text-gray-800">家計簿</h1>
      </div>

      {/* インポートボタン */}
      <input ref={bankFileRef} type="file" accept=".csv" className="hidden" onChange={handleBankFile} />
      <input ref={cardFileRef} type="file" accept=".csv" className="hidden" onChange={handleCardFile} />

      <div className="flex gap-2 mb-3">
        <button
          onClick={() => { setCsvError(''); bankFileRef.current?.click(); }}
          className="flex-1 py-2 bg-white border border-dashed border-[#2d5f3f]/40 text-[#2d5f3f] rounded-xl text-xs font-medium hover:bg-[#2d5f3f]/5 transition-colors flex items-center justify-center gap-1.5"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 flex-shrink-0">
            <rect x="2" y="5" width="20" height="14" rx="2" />
            <path d="M2 10h20" />
          </svg>
          楽天銀行明細 CSV
        </button>
        <button
          onClick={() => { setCsvError(''); cardFileRef.current?.click(); }}
          className="flex-1 py-2 bg-white border border-dashed border-[#c47c2b]/40 text-[#c47c2b] rounded-xl text-xs font-medium hover:bg-[#c47c2b]/5 transition-colors flex items-center justify-center gap-1.5"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 flex-shrink-0">
            <rect x="1" y="4" width="22" height="16" rx="2" />
            <line x1="1" y1="10" x2="23" y2="10" />
          </svg>
          楽天カード明細 CSV
        </button>
      </div>

      {csvError && <p className="text-xs text-[#b83232] text-center mb-2">{csvError}</p>}

      {/* 手動入力トグル */}
      <div className="mb-5">
        {!showManualForm ? (
          <button
            onClick={() => setShowManualForm(true)}
            className="w-full py-3 text-sm text-gray-400 border border-black/8 rounded-xl hover:bg-gray-50 transition-colors flex items-center justify-center gap-2"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            手動で入力
          </button>
        ) : (
          <div className="bg-white rounded-2xl shadow-sm border border-black/5 p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold text-gray-800">手動で追加</h2>
              <button onClick={() => setShowManualForm(false)} className="text-xs text-gray-400">閉じる</button>
            </div>
            <div className="flex gap-2 mb-4">
              {USERS.map((u) => (
                <button key={u} onClick={() => setSelectedUser(u)}
                  className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${selectedUser === u ? 'bg-[#2d5f3f] text-white' : 'bg-gray-100 text-gray-600'}`}>
                  {u}
                </button>
              ))}
            </div>
            <form onSubmit={handleSubmit}>
              <div className="flex rounded-xl overflow-hidden border border-black/10 mb-4">
                <button type="button" onClick={() => setTxType('expense')}
                  className={`flex-1 py-3 text-sm font-semibold transition-colors ${txType === 'expense' ? 'bg-[#b83232] text-white' : 'bg-gray-50 text-gray-500'}`}>支出</button>
                <button type="button" onClick={() => setTxType('income')}
                  className={`flex-1 py-3 text-sm font-semibold transition-colors ${txType === 'income' ? 'bg-[#2d5f3f] text-white' : 'bg-gray-50 text-gray-500'}`}>収入</button>
              </div>
              <div className="mb-4">
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-bold text-lg">¥</span>
                  <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)}
                    placeholder="0" min="1" required
                    className="w-full pl-9 pr-4 py-3.5 text-xl font-bold border border-black/15 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#2d5f3f]" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <select value={category} onChange={(e) => setCategory(e.target.value)}
                  className="px-3 py-3 text-sm border border-black/15 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#2d5f3f] bg-white">
                  {(txType === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES).map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required
                  className="px-3 py-3 text-sm border border-black/15 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#2d5f3f]" />
              </div>
              <input type="text" value={description} onChange={(e) => setDescription(e.target.value)}
                placeholder="メモ（任意）"
                className="w-full px-4 py-3 text-sm border border-black/15 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#2d5f3f] mb-4" />
              <button type="submit" disabled={submitting || !amount}
                className="w-full py-3.5 bg-[#2d5f3f] text-white rounded-xl font-semibold text-base disabled:opacity-50">
                {submitting ? '保存中…' : '追加する'}
              </button>
            </form>
          </div>
        )}
      </div>

      {/* 月ナビゲーター */}
      <div className="flex items-center justify-between mb-1">
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
          <p className="text-base font-bold text-gray-800">{getMonthLabel(viewMonth)}</p>
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
      <div className="flex justify-end mb-3">
        {monthTx.length > 0 && (
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="text-xs text-gray-300 hover:text-[#b83232] transition-colors"
          >
            一括削除
          </button>
        )}
      </div>

      {/* 月サマリー */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        {[
          { label: '収入', value: monthIncome, color: 'text-[#2d5f3f]' },
          { label: '支出', value: monthExpense, color: 'text-[#b83232]' },
          { label: '収支', value: monthBalance, color: monthBalance >= 0 ? 'text-[#2d5f3f]' : 'text-[#b83232]' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-white rounded-xl border border-black/5 shadow-sm p-4">
            <p className="text-xs text-gray-400 mb-2">{label}</p>
            <p className={`text-sm font-bold ${color} leading-tight whitespace-nowrap overflow-hidden text-ellipsis`}>
              {value < 0 ? '-' : label === '収支' && value > 0 ? '+' : ''}¥{formatJPY(value)}
            </p>
          </div>
        ))}
      </div>

      {/* トランザクション一覧 */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-7 h-7 border-2 border-gray-200 border-t-[#2d5f3f] rounded-full animate-spin-custom" />
        </div>
      ) : monthTx.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-12 h-12 mx-auto mb-3 text-gray-300">
            <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <p className="text-sm">この月の記録はありません</p>
          <p className="text-xs mt-1 text-gray-300">口座明細をインポートしてください</p>
        </div>
      ) : (
        <div className="space-y-5">
          {sortedDates.map((dateKey) => (
            <div key={dateKey}>
              <div className="text-xs font-bold text-gray-400 mb-3 px-1">{dateKey.replace(/-/g, '/')}</div>
              <div className="space-y-2">
                {byDate[dateKey].map((t) => {
                  const linkedStatement = t.cardStatementId
                    ? cardStatements.find((s) => s.id === t.cardStatementId)
                    : null;
                  const isExpanded = expandedTxId === t.id;

                  return (
                    <div key={t.id}>
                      <div className={`bg-white rounded-2xl border shadow-sm px-4 py-4 flex items-center gap-3 ${
                        isExpanded ? 'border-[#c47c2b]/20 rounded-b-none' : 'border-black/5'
                      }`}>
                        <div className={`w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center ${
                          t.isCardPayment ? 'bg-[#fdf3e3]' : t.type === 'income' ? 'bg-[#e8f0eb]' : 'bg-[#fbeaea]'
                        }`}>
                          {t.isCardPayment ? (
                            <svg viewBox="0 0 24 24" fill="none" stroke="#c47c2b" strokeWidth="2" className="w-5 h-5">
                              <rect x="1" y="4" width="22" height="16" rx="2" />
                              <line x1="1" y1="10" x2="23" y2="10" />
                            </svg>
                          ) : t.type === 'income' ? (
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
                          <p className={`text-sm font-semibold truncate ${t.excludeFromBalance ? 'text-gray-300 line-through' : 'text-gray-700'}`}>
                            {t.description || 'ー'}
                          </p>
                          {(linkedStatement || t.excludeFromBalance) && (
                            <div className="flex items-center gap-1.5 mt-0.5">
                              {linkedStatement && (
                                <span className="text-xs bg-[#c47c2b]/10 text-[#c47c2b] px-1.5 py-0.5 rounded-full">明細リンク済</span>
                              )}
                              {t.excludeFromBalance && (
                                <span className="text-xs bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded-full">収支除外</span>
                              )}
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <span className={`text-sm font-bold whitespace-nowrap ${
                            t.excludeFromBalance ? 'text-gray-300' : t.type === 'income' ? 'text-[#2d5f3f]' : 'text-[#b83232]'
                          }`}>
                            {t.type === 'income' ? '+' : '-'}¥{formatJPY(t.amount)}
                          </span>
                          <button
                            onClick={() => handleToggleExclude(t.id, t.excludeFromBalance)}
                            className={`w-6 h-6 flex items-center justify-center rounded-full border transition-colors flex-shrink-0 ${
                              t.excludeFromBalance
                                ? 'bg-gray-100 border-gray-300 text-gray-400'
                                : 'border-gray-200 text-gray-300 hover:border-gray-300 hover:text-gray-400'
                            }`}
                            title={t.excludeFromBalance ? '収支に含める' : '収支から除外'}
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-3 h-3">
                              <circle cx="12" cy="12" r="9" />
                              <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                            </svg>
                          </button>
                          {linkedStatement && (
                            <button
                              onClick={() => setExpandedTxId(isExpanded ? null : t.id)}
                              className={`w-7 h-7 flex items-center justify-center rounded-lg transition-colors ${
                                isExpanded ? 'bg-[#c47c2b] text-white' : 'text-[#c47c2b] border border-[#c47c2b]/30'
                              }`}
                              aria-label="カード明細を展開"
                            >
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                                className={`w-3.5 h-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
                                <polyline points="6 9 12 15 18 9" />
                              </svg>
                            </button>
                          )}
                          <button onClick={() => handleDelete(t.id)}
                            className="text-gray-300 hover:text-[#b83232] transition-colors p-1" aria-label="削除">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6l-1 14H6L5 6M10 11v6M14 11v6M9 6V4h6v2" />
                            </svg>
                          </button>
                        </div>
                      </div>

                      {/* カード明細ドリルダウン */}
                      {isExpanded && linkedStatement && (
                        <div className="bg-[#fdf8f3] rounded-b-2xl border border-t-0 border-[#c47c2b]/20 overflow-hidden">
                          <div className="px-4 py-2 border-b border-[#c47c2b]/10 flex items-center justify-between">
                            <p className="text-xs font-semibold text-[#c47c2b]">
                              カード明細 {linkedStatement.items?.length}件
                            </p>
                            <div className="flex items-center gap-3">
                              {(() => {
                                const excluded = (linkedStatement.items || []).filter((i) => i.excludeFromBalance).reduce((s, i) => s + (i.amount || 0), 0);
                                const effective = linkedStatement.totalAmount - excluded;
                                return excluded > 0
                                  ? <p className="text-xs text-[#c47c2b]">有効 ¥{formatJPY(effective)} <span className="text-gray-300">(除外 ¥{formatJPY(excluded)})</span></p>
                                  : <p className="text-xs text-[#c47c2b]">合計 ¥{formatJPY(linkedStatement.totalAmount)}</p>;
                              })()}
                            </div>
                          </div>
                          <div className="divide-y divide-[#c47c2b]/8">
                            {(linkedStatement.items || []).map((item, i) => (
                              <div key={i} className={`px-4 py-2.5 flex items-center justify-between gap-2 ${item.excludeFromBalance ? 'opacity-50' : ''}`}>
                                <div className="flex-1 min-w-0">
                                  <p className={`text-xs font-medium truncate ${item.excludeFromBalance ? 'text-gray-400 line-through' : 'text-gray-700'}`}>{item.merchant}</p>
                                  <p className="text-xs text-gray-400">
                                    {item.date.replace(/-/g, '/')} · {item.addedBy}
                                  </p>
                                </div>
                                <span className={`text-sm font-semibold flex-shrink-0 ${item.excludeFromBalance ? 'text-gray-300 line-through' : 'text-[#b83232]'}`}>
                                  ¥{formatJPY(item.amount)}
                                </span>
                                <button
                                  onClick={() => handleToggleCardItemExclude(linkedStatement.id, i, item.excludeFromBalance)}
                                  className={`w-6 h-6 flex items-center justify-center rounded-full border transition-colors flex-shrink-0 ${
                                    item.excludeFromBalance
                                      ? 'bg-gray-100 border-gray-300 text-gray-400'
                                      : 'border-gray-200 text-gray-300 hover:border-gray-300 hover:text-gray-400'
                                  }`}
                                  title={item.excludeFromBalance ? '収支に含める' : '収支から除外'}
                                >
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-3 h-3">
                                    <circle cx="12" cy="12" r="9" />
                                    <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                                  </svg>
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 口座明細プレビューモーダル */}
      {bankCsvRows && (
        <div className="fixed inset-0 z-50 flex flex-col bg-[#f5f0eb]">
          <div className="bg-white border-b border-black/5 px-5 py-4 flex items-center gap-3 flex-shrink-0">
            <button onClick={() => setBankCsvRows(null)}
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-black/10 text-gray-500">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                <path d="M19 12H5M12 5l-7 7 7 7" />
              </svg>
            </button>
            <div className="flex-1">
              <h2 className="text-sm font-bold text-gray-800">口座明細インポート確認</h2>
              <p className="text-xs text-gray-400">{bankCsvRows.length}件 · {bankSelectedCount}件選択中</p>
            </div>
            <button
              onClick={() => setBankCsvRows((rows) => rows.map((r) => ({ ...r, selected: true })))}
              className="text-xs text-[#2d5f3f] px-3 py-1 rounded-lg border border-[#2d5f3f]/20">
              全選択
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
            {bankCsvRows.map((row, idx) => (
              <div key={idx} className={`bg-white rounded-2xl border px-4 py-3.5 transition-opacity ${
                row.selected ? 'border-black/5 shadow-sm' : 'border-black/5 opacity-40'
              }`}>
                <div className="flex items-start gap-3">
                  <button onClick={() => toggleBankRow(idx)}
                    className={`w-5 h-5 rounded-md border-2 flex-shrink-0 mt-0.5 flex items-center justify-center transition-colors ${
                      row.selected ? 'bg-[#2d5f3f] border-[#2d5f3f]' : 'border-gray-300 bg-white'
                    }`}>
                    {row.selected && (
                      <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" className="w-3 h-3">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-400">{row.date.replace(/-/g, '/')}</span>
                        {row.isDuplicate && (
                          <span className="text-xs bg-orange-100 text-orange-500 px-1.5 py-0.5 rounded-full font-medium">重複</span>
                        )}
                      </div>
                      <span className={`text-base font-bold ${row.type === 'income' ? 'text-[#2d5f3f]' : 'text-[#b83232]'}`}>
                        {row.type === 'income' ? '+' : '-'}¥{formatJPY(row.amount)}
                      </span>
                    </div>
                    <p className="text-sm font-medium text-gray-700 truncate mb-2">{row.description}</p>

                    {row.isCardPayment ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs bg-[#c47c2b]/10 text-[#c47c2b] px-2.5 py-1.5 rounded-lg font-medium">
                          💳 カード払い ― カード明細とリンクされます
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <div className="flex rounded-lg overflow-hidden border border-black/10 text-xs flex-shrink-0">
                          <button onClick={() => updateBankType(idx, 'expense')}
                            className={`px-2.5 py-1.5 font-medium transition-colors ${row.type === 'expense' ? 'bg-[#b83232] text-white' : 'bg-gray-50 text-gray-500'}`}>
                            支出
                          </button>
                          <button onClick={() => updateBankType(idx, 'income')}
                            className={`px-2.5 py-1.5 font-medium transition-colors ${row.type === 'income' ? 'bg-[#2d5f3f] text-white' : 'bg-gray-50 text-gray-500'}`}>
                            収入
                          </button>
                        </div>
                        <select value={row.category} onChange={(e) => updateBankCategory(idx, e.target.value)}
                          disabled={!row.selected}
                          className="flex-1 px-2 py-1.5 text-xs border border-black/10 rounded-lg bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#2d5f3f]">
                          {(row.type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES).map((c) => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                      </div>
                    )}
                    <label className="flex items-center gap-1.5 mt-1.5 cursor-pointer w-fit">
                      <input
                        type="checkbox"
                        checked={row.excludeFromBalance || false}
                        onChange={() => toggleBankExclude(idx)}
                        disabled={!row.selected}
                        className="w-3.5 h-3.5 rounded border-gray-300 accent-gray-400"
                      />
                      <span className="text-xs text-gray-400">収支から除外</span>
                    </label>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="bg-white border-t border-black/5 px-5 py-4 flex-shrink-0">
            <button onClick={handleBankImport} disabled={csvImporting || bankSelectedCount === 0}
              className="w-full py-3.5 bg-[#2d5f3f] text-white rounded-xl font-semibold text-base disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#24502f] transition-colors">
              {csvImporting ? 'インポート中…' : `${bankSelectedCount}件をインポート`}
            </button>
          </div>
        </div>
      )}

      {/* 一括削除確認モーダル */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-5">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl">
            <h3 className="text-base font-bold text-gray-800 mb-2">一括削除</h3>
            <p className="text-sm text-gray-500 mb-5">
              {getMonthLabel(viewMonth)}の記録 {monthTx.length}件をすべて削除しますか？<br />
              <span className="text-xs text-[#b83232]">この操作は元に戻せません。</span>
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 py-3 border border-black/10 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
              >
                キャンセル
              </button>
              <button
                onClick={handleBulkDelete}
                className="flex-1 py-3 bg-[#b83232] text-white rounded-xl text-sm font-medium hover:bg-[#9e2a2a] transition-colors"
              >
                削除する
              </button>
            </div>
          </div>
        </div>
      )}

      {/* カード明細プレビューモーダル */}
      {cardCsvRows && (
        <div className="fixed inset-0 z-50 flex flex-col bg-[#f5f0eb]">
          <div className="bg-white border-b border-black/5 px-5 py-4 flex items-center gap-3 flex-shrink-0">
            <button onClick={() => setCardCsvRows(null)}
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-black/10 text-gray-500">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                <path d="M19 12H5M12 5l-7 7 7 7" />
              </svg>
            </button>
            <div className="flex-1">
              <h2 className="text-sm font-bold text-gray-800">カード明細インポート確認</h2>
              <p className="text-xs text-gray-400">{cardCsvRows.length}件 · {cardSelectedCount}件選択中</p>
            </div>
            <button
              onClick={() => setCardCsvRows((rows) => rows.map((r) => ({ ...r, selected: true })))}
              className="text-xs text-[#c47c2b] px-3 py-1 rounded-lg border border-[#c47c2b]/20">
              全選択
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
            {cardCsvRows.map((row, idx) => (
              <div key={idx} className={`bg-white rounded-2xl border px-4 py-3.5 transition-opacity ${
                row.selected ? 'border-black/5 shadow-sm' : 'border-black/5 opacity-40'
              }`}>
                <div className="flex items-start gap-3">
                  <button onClick={() => toggleCardRow(idx)}
                    className={`w-5 h-5 rounded-md border-2 flex-shrink-0 mt-0.5 flex items-center justify-center transition-colors ${
                      row.selected ? 'bg-[#c47c2b] border-[#c47c2b]' : 'border-gray-300 bg-white'
                    }`}>
                    {row.selected && (
                      <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" className="w-3 h-3">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-400">{row.date.replace(/-/g, '/')}</span>
                        <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{row.addedBy}</span>
                      </div>
                      <span className="text-base font-bold text-[#b83232]">¥{formatJPY(row.amount)}</span>
                    </div>
                    <p className={`text-sm font-medium truncate mb-2 ${row.excludeFromBalance ? 'text-gray-300 line-through' : 'text-gray-700'}`}>{row.merchant}</p>
                    <div className="flex items-center gap-2">
                      <select value={row.category} onChange={(e) => updateCardCategory(idx, e.target.value)}
                        disabled={!row.selected}
                        className="flex-1 px-2 py-1.5 text-xs border border-black/10 rounded-lg bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#c47c2b]">
                        {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                    <label className="flex items-center gap-1.5 mt-1.5 cursor-pointer w-fit">
                      <input
                        type="checkbox"
                        checked={row.excludeFromBalance || false}
                        onChange={() => toggleCardExclude(idx)}
                        disabled={!row.selected}
                        className="w-3.5 h-3.5 rounded border-gray-300 accent-gray-400"
                      />
                      <span className="text-xs text-gray-400">収支から除外</span>
                    </label>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="bg-white border-t border-black/5 px-5 py-4 flex-shrink-0">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-gray-500">合計</span>
              <span className="text-lg font-bold text-[#b83232]">
                ¥{formatJPY(cardCsvRows.filter((r) => r.selected).reduce((s, r) => s + r.amount, 0))}
              </span>
            </div>
            <button onClick={handleCardImport} disabled={csvImporting || cardSelectedCount === 0}
              className="w-full py-3.5 bg-[#c47c2b] text-white rounded-xl font-semibold text-base disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#b06b20] transition-colors">
              {csvImporting ? 'インポート中…' : `${cardSelectedCount}件をインポート`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
