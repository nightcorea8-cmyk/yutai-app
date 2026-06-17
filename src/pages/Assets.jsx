import React, { useState, useEffect, useCallback } from 'react';
import { db } from '../firebase.js';
import {
  collection, onSnapshot, addDoc, deleteDoc, updateDoc,
  doc, serverTimestamp,
} from 'firebase/firestore';

function formatJPY(n) {
  return new Intl.NumberFormat('ja-JP').format(Math.abs(n));
}

const ASSET_TYPES = [
  { value: 'bank', label: '銀行', color: 'bg-blue-100 text-blue-700' },
  { value: 'stock', label: '株式', color: 'bg-red-100 text-red-700' },
  { value: 'fund', label: '投資信託', color: 'bg-purple-100 text-purple-700' },
  { value: 'other', label: 'その他', color: 'bg-gray-100 text-gray-600' },
];

function typeLabel(type) {
  return ASSET_TYPES.find((t) => t.value === type)?.label || 'その他';
}

function typeColor(type) {
  return ASSET_TYPES.find((t) => t.value === type)?.color || 'bg-gray-100 text-gray-600';
}

const EMPTY_FORM = { name: '', type: 'bank', amount: '', note: '' };

export default function Assets() {
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [inlineEdit, setInlineEdit] = useState({}); // id -> form state for inline editing

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'assets'), (snap) => {
      setAssets(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }, () => { setLoading(false); });
    return unsub;
  }, []);

  const totalAssets = assets.reduce((s, a) => s + (a.amount || 0), 0);

  // Breakdown by type
  const byType = ASSET_TYPES.map(({ value, label }) => {
    const sum = assets.filter((a) => a.type === value).reduce((s, a) => s + (a.amount || 0), 0);
    return { type: value, label, sum };
  }).filter((t) => t.sum > 0);

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    if (!form.name.trim() || !form.amount) return;
    setSubmitting(true);
    try {
      if (editingId) {
        await updateDoc(doc(db, 'assets', editingId), {
          name: form.name.trim(),
          type: form.type,
          amount: Number(form.amount),
          note: form.note.trim(),
          updatedAt: serverTimestamp(),
        });
        setEditingId(null);
      } else {
        await addDoc(collection(db, 'assets'), {
          name: form.name.trim(),
          type: form.type,
          amount: Number(form.amount),
          note: form.note.trim(),
          updatedAt: serverTimestamp(),
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
  }, [form, editingId]);

  const startEdit = useCallback((asset) => {
    setEditingId(asset.id);
    setForm({
      name: asset.name || '',
      type: asset.type || 'bank',
      amount: String(asset.amount || ''),
      note: asset.note || '',
    });
    setShowForm(true);
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowForm(false);
  }, []);

  const handleDelete = useCallback(async (id) => {
    if (!confirm('この資産を削除しますか？')) return;
    try {
      await deleteDoc(doc(db, 'assets', id));
    } catch {
      alert('削除に失敗しました');
    }
  }, []);

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <div className="mb-4">
        <h1 className="text-base font-bold text-gray-800">資産管理</h1>
      </div>

      {/* Total */}
      <div className="bg-white rounded-2xl shadow-sm border border-black/5 p-5 mb-4">
        <p className="text-xs text-gray-500 mb-1">資産総額</p>
        <p className="text-3xl font-bold text-[#c47c2b]">¥{formatJPY(totalAssets)}</p>

        {/* Breakdown */}
        {byType.length > 0 && (
          <div className="mt-4 space-y-2">
            {byType.map(({ type, label, sum }) => {
              const pct = totalAssets > 0 ? Math.round((sum / totalAssets) * 100) : 0;
              return (
                <div key={type}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${typeColor(type)}`}>
                        {label}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400">{pct}%</span>
                      <span className="text-sm font-medium text-gray-700">¥{formatJPY(sum)}</span>
                    </div>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[#c47c2b] rounded-full"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add button or form */}
      {!showForm && (
        <button
          onClick={() => { setShowForm(true); setEditingId(null); setForm(EMPTY_FORM); }}
          className="w-full py-2.5 bg-[#2d5f3f] text-white rounded-xl font-medium text-sm hover:bg-[#24502f] transition-colors mb-4 flex items-center justify-center gap-2"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          資産を追加
        </button>
      )}

      {/* Form */}
      {showForm && (
        <div className="bg-white rounded-2xl shadow-sm border border-black/5 p-4 mb-4">
          <h2 className="text-sm font-bold text-gray-800 mb-3">
            {editingId ? '資産を編集' : '資産を追加'}
          </h2>
          <form onSubmit={handleSubmit}>
            <div className="mb-3">
              <label className="block text-xs text-gray-500 mb-1 font-medium">名称 *</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="例：三菱UFJ銀行"
                required
                className="w-full px-3 py-2.5 text-sm border border-black/15 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#2d5f3f]"
              />
            </div>

            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1 font-medium">種類</label>
                <select
                  value={form.type}
                  onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
                  className="w-full px-3 py-2.5 text-sm border border-black/15 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#2d5f3f] bg-white"
                >
                  {ASSET_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1 font-medium">金額 *</label>
                <div className="relative">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs">¥</span>
                  <input
                    type="number"
                    min="0"
                    value={form.amount}
                    onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                    placeholder="0"
                    required
                    className="w-full pl-6 pr-2 py-2.5 text-sm border border-black/15 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#2d5f3f]"
                  />
                </div>
              </div>
            </div>

            <div className="mb-3">
              <label className="block text-xs text-gray-500 mb-1 font-medium">メモ（任意）</label>
              <input
                type="text"
                value={form.note}
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                placeholder="例：普通口座"
                className="w-full px-3 py-2.5 text-sm border border-black/15 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#2d5f3f]"
              />
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={cancelEdit}
                className="px-4 py-2.5 text-sm border border-black/15 rounded-xl text-gray-600 hover:bg-gray-50 transition-colors"
              >
                キャンセル
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="flex-1 py-2.5 bg-[#2d5f3f] text-white rounded-xl font-medium text-sm disabled:opacity-50 hover:bg-[#24502f] transition-colors"
              >
                {submitting ? '保存中…' : editingId ? '更新する' : '追加する'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Asset list */}
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
        <div className="space-y-2">
          {assets
            .slice()
            .sort((a, b) => (b.amount || 0) - (a.amount || 0))
            .map((asset) => (
              <div
                key={asset.id}
                className="bg-white rounded-xl border border-black/5 shadow-sm px-4 py-3 flex items-center gap-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${typeColor(asset.type)}`}>
                      {typeLabel(asset.type)}
                    </span>
                  </div>
                  <p className="text-sm font-medium text-gray-800 truncate">{asset.name}</p>
                  {asset.note && (
                    <p className="text-xs text-gray-400 truncate">{asset.note}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-base font-bold text-gray-800">
                    ¥{formatJPY(asset.amount || 0)}
                  </span>
                  <button
                    onClick={() => startEdit(asset)}
                    className="text-gray-400 hover:text-[#2d5f3f] transition-colors p-1"
                    aria-label="編集"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
                      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => handleDelete(asset.id)}
                    className="text-gray-300 hover:text-[#b83232] transition-colors p-1"
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
      )}
    </div>
  );
}
