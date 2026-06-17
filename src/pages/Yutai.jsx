import React, { useState, useEffect, useCallback, useRef } from 'react';
import { db } from '../firebase.js';
import {
  collection, onSnapshot, addDoc, deleteDoc, updateDoc,
  doc, serverTimestamp, query, orderBy,
} from 'firebase/firestore';

const USERS = ['ひゅうご', 'なる'];
const PRIORITY_ORDER = { high: 0, mid: 1, low: 2 };
const PRIORITY_LABEL = { high: '優先度：高', mid: '優先度：中', low: '優先度：低' };
const PRIORITY_BADGE = {
  high: 'bg-red-100 text-red-700',
  mid: 'bg-yellow-100 text-yellow-700',
  low: 'bg-gray-100 text-gray-600',
};

function todayDate() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function daysLeft(ds) {
  return Math.round((new Date(ds) - todayDate()) / 86400000);
}

function expiryBadge(expiry) {
  if (!expiry) return null;
  const dl = daysLeft(expiry);
  if (dl < 0) return { label: '期限切れ', cls: 'bg-red-100 text-red-700' };
  if (dl === 0) return { label: '本日まで', cls: 'bg-red-100 text-red-700' };
  if (dl <= 7) return { label: `残${dl}日`, cls: 'bg-orange-100 text-orange-700' };
  if (dl <= 30) return { label: `残${dl}日`, cls: 'bg-yellow-100 text-yellow-700' };
  return { label: `残${dl}日`, cls: 'bg-green-100 text-green-700' };
}

function compressImage(file, maxPx = 800, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = reject;
    r.onload = (ev) => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        let { width: w, height: h } = img;
        if (w > maxPx || h > maxPx) {
          if (w >= h) { h = Math.round((h * maxPx) / w); w = maxPx; }
          else { w = Math.round((w * maxPx) / h); h = maxPx; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = ev.target.result;
    };
    r.readAsDataURL(file);
  });
}

const EMPTY_FORM = { name: '', content: '', expiry: '', priority: 'mid', addedBy: 'ひゅうご' };

export default function Yutai() {
  const [stocks, setStocks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('list'); // 'list' | 'calendar'
  const [sortMode, setSortMode] = useState('registered'); // 'registered' | 'expiry' | 'priority'
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [pendingPhoto, setPendingPhoto] = useState(null); // null | string (dataUrl) | undefined (keep existing)
  const [photoCompressing, setPhotoCompressing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [viewerSrc, setViewerSrc] = useState(null);
  const [calYear, setCalYear] = useState(new Date().getFullYear());
  const [calMonth, setCalMonth] = useState(new Date().getMonth() + 1);
  const photoInputRef = useRef(null);
  const cardPhotoRefs = useRef({});

  useEffect(() => {
    const q = query(collection(db, 'stocks'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      setStocks(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }, () => { setLoading(false); });
    return unsub;
  }, []);

  const sortedStocks = useCallback(() => {
    const arr = [...stocks];
    if (sortMode === 'expiry') {
      arr.sort((a, b) => {
        if (!a.expiry && !b.expiry) return 0;
        if (!a.expiry) return 1;
        if (!b.expiry) return -1;
        return new Date(a.expiry) - new Date(b.expiry);
      });
    } else if (sortMode === 'priority') {
      arr.sort((a, b) => {
        const pa = PRIORITY_ORDER[a.priority] ?? 1;
        const pb = PRIORITY_ORDER[b.priority] ?? 1;
        if (pa !== pb) return pa - pb;
        if (!a.expiry && !b.expiry) return 0;
        if (!a.expiry) return 1;
        if (!b.expiry) return -1;
        return new Date(a.expiry) - new Date(b.expiry);
      });
    }
    return arr;
  }, [stocks, sortMode]);

  const openAdd = useCallback(() => {
    setEditingId(null);
    setForm({ ...EMPTY_FORM, addedBy: localStorage.getItem('selectedUser') || 'ひゅうご' });
    setPendingPhoto(null);
    setShowModal(true);
  }, []);

  const openEdit = useCallback((stock) => {
    setEditingId(stock.id);
    setForm({
      name: stock.name || '',
      content: stock.content || '',
      expiry: stock.expiry || '',
      priority: stock.priority || 'mid',
      addedBy: stock.addedBy || 'ひゅうご',
    });
    setPendingPhoto(undefined); // undefined = keep existing
    setShowModal(true);
  }, []);

  const closeModal = useCallback(() => {
    setShowModal(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setPendingPhoto(null);
  }, []);

  const handlePhotoChange = useCallback(async (file) => {
    if (!file) return;
    setPhotoCompressing(true);
    try {
      const compressed = await compressImage(file);
      setPendingPhoto(compressed);
    } catch {
      alert('画像の読み込みに失敗しました。別の画像をお試しください。');
    } finally {
      setPhotoCompressing(false);
    }
  }, []);

  const handleCardPhotoChange = useCallback(async (stockId, file) => {
    if (!file) return;
    try {
      const compressed = await compressImage(file);
      await updateDoc(doc(db, 'stocks', stockId), { photo: compressed });
    } catch {
      alert('画像の読み込みに失敗しました。');
    }
  }, []);

  const handleSave = useCallback(async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { alert('銘柄名は必須です'); return; }
    setSubmitting(true);
    try {
      if (editingId) {
        const existing = stocks.find((s) => s.id === editingId);
        const photo = pendingPhoto !== undefined ? pendingPhoto : (existing?.photo ?? null);
        await updateDoc(doc(db, 'stocks', editingId), {
          name: form.name.trim(),
          content: form.content.trim(),
          expiry: form.expiry,
          priority: form.priority,
          addedBy: form.addedBy,
          photo,
        });
      } else {
        await addDoc(collection(db, 'stocks'), {
          name: form.name.trim(),
          content: form.content.trim(),
          expiry: form.expiry,
          priority: form.priority,
          addedBy: form.addedBy,
          photo: pendingPhoto || null,
          createdAt: serverTimestamp(),
        });
      }
      closeModal();
    } catch (err) {
      console.error(err);
      alert('保存に失敗しました');
    } finally {
      setSubmitting(false);
    }
  }, [form, editingId, stocks, pendingPhoto, closeModal]);

  const handleDelete = useCallback(async (id) => {
    if (!confirm('この銘柄を削除しますか？')) return;
    try {
      await deleteDoc(doc(db, 'stocks', id));
    } catch {
      alert('削除に失敗しました');
    }
  }, []);

  // Stats
  const totalCount = stocks.length;
  const expiringSoon = stocks.filter((s) => s.expiry && daysLeft(s.expiry) >= 0 && daysLeft(s.expiry) <= 30).length;
  const highPriority = stocks.filter((s) => s.priority === 'high').length;

  // Calendar rendering
  const months = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
  const days = ['日', '月', '火', '水', '木', '金', '土'];
  const calCells = () => {
    const cells = [];
    const firstDow = new Date(calYear, calMonth - 1, 1).getDay();
    const lastDay = new Date(calYear, calMonth, 0).getDate();
    const td = todayDate();
    for (let i = 0; i < firstDow; i++) cells.push({ empty: true, key: `e${i}` });
    for (let d = 1; d <= lastDay; d++) {
      const isToday = d === td.getDate() && calMonth === td.getMonth() + 1 && calYear === td.getFullYear();
      const deadlines = stocks.filter((s) => {
        if (!s.expiry) return false;
        const ed = new Date(s.expiry);
        return ed.getFullYear() === calYear && ed.getMonth() + 1 === calMonth && ed.getDate() === d;
      });
      cells.push({ d, isToday, deadlines, key: `d${d}` });
    }
    return cells;
  };

  const list = sortedStocks();

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <div className="mb-4">
        <h1 className="text-base font-bold text-gray-800">株主優待</h1>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        {[
          { label: '保有銘柄', value: totalCount },
          { label: '期限間近', value: expiringSoon },
          { label: '優先度：高', value: highPriority },
        ].map(({ label, value }) => (
          <div key={label} className="bg-white rounded-xl border border-black/5 shadow-sm p-3 text-center">
            <p className="text-xs text-gray-400 mb-1">{label}</p>
            <p className="text-2xl font-bold text-gray-800">{loading ? '-' : value}</p>
          </div>
        ))}
      </div>

      {/* Tab switcher */}
      <div className="flex rounded-xl overflow-hidden border border-black/10 bg-white mb-4">
        {['list', 'calendar'].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-2 text-sm font-medium transition-colors ${
              activeTab === tab ? 'bg-[#2d5f3f] text-white' : 'text-gray-500 hover:bg-gray-50'
            }`}
          >
            {tab === 'list' ? '銘柄一覧' : 'カレンダー'}
          </button>
        ))}
      </div>

      {/* LIST TAB */}
      {activeTab === 'list' && (
        <>
          {/* Sort bar */}
          <div className="flex gap-2 mb-3 flex-wrap">
            {[
              { mode: 'registered', label: '登録順' },
              { mode: 'expiry', label: '使用期限順' },
              { mode: 'priority', label: '優先度順' },
            ].map(({ mode, label }) => (
              <button
                key={mode}
                onClick={() => setSortMode(mode)}
                className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
                  sortMode === mode
                    ? 'bg-[#2d5f3f] text-white border-[#2d5f3f]'
                    : 'bg-white text-gray-500 border-black/15 hover:bg-gray-50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Add button */}
          <button
            onClick={openAdd}
            className="w-full py-2.5 bg-[#2d5f3f] text-white rounded-xl font-medium text-sm hover:bg-[#24502f] transition-colors mb-4 flex items-center justify-center gap-2"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            銘柄を追加
          </button>

          {/* Stock list */}
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-7 h-7 border-2 border-gray-200 border-t-[#2d5f3f] rounded-full animate-spin-custom" />
            </div>
          ) : list.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-10 h-10 mx-auto mb-2 text-gray-300">
                <path d="M9 17H7A5 5 0 017 7h2M15 7h2a5 5 0 010 10h-2M9 12h6" />
              </svg>
              <p className="text-sm">まだ銘柄が登録されていません</p>
            </div>
          ) : (
            <div className="space-y-3">
              {list.map((stock) => {
                const badge = expiryBadge(stock.expiry);
                return (
                  <div
                    key={stock.id}
                    className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden flex"
                  >
                    {/* Photo area */}
                    <div
                      className="w-22 min-h-[88px] flex-shrink-0 bg-gray-50 border-r border-black/5 flex flex-col items-center justify-center cursor-pointer relative overflow-hidden"
                      style={{ width: 88 }}
                      onClick={() => {
                        if (stock.photo) {
                          setViewerSrc(stock.photo);
                        } else {
                          // Trigger file input for this card
                          if (!cardPhotoRefs.current[stock.id]) {
                            const inp = document.createElement('input');
                            inp.type = 'file';
                            inp.accept = 'image/*';
                            inp.style.display = 'none';
                            inp.addEventListener('change', (e) => {
                              const f = e.target.files[0];
                              if (f) handleCardPhotoChange(stock.id, f);
                            });
                            document.body.appendChild(inp);
                            cardPhotoRefs.current[stock.id] = inp;
                          }
                          cardPhotoRefs.current[stock.id].click();
                        }
                      }}
                    >
                      {stock.photo ? (
                        <img
                          src={stock.photo}
                          alt="優待券写真"
                          className="absolute inset-0 w-full h-full object-cover"
                        />
                      ) : (
                        <>
                          <svg viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="1.5" className="w-6 h-6">
                            <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
                            <circle cx="12" cy="13" r="4" />
                          </svg>
                          <span className="text-xs text-gray-400 mt-1">追加</span>
                        </>
                      )}
                    </div>

                    {/* Body */}
                    <div
                      className="flex-1 p-3 min-w-0 cursor-pointer"
                      onClick={() => openEdit(stock)}
                    >
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <p className="text-sm font-bold text-gray-800 leading-tight">{stock.name}</p>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDelete(stock.id); }}
                          className="text-gray-300 hover:text-red-500 transition-colors p-0.5 flex-shrink-0"
                          aria-label="削除"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6l-1 14H6L5 6M10 11v6M14 11v6M9 6V4h6v2" />
                          </svg>
                        </button>
                      </div>

                      {/* Badges */}
                      <div className="flex flex-wrap gap-1 mb-1.5">
                        {stock.priority && (
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PRIORITY_BADGE[stock.priority]}`}>
                            {PRIORITY_LABEL[stock.priority]}
                          </span>
                        )}
                        {badge && (
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badge.cls}`}>
                            {badge.label}
                          </span>
                        )}
                      </div>

                      {stock.content && (
                        <p className="text-xs text-gray-500 leading-relaxed line-clamp-2">{stock.content}</p>
                      )}

                      <div className="flex items-center justify-between mt-1.5">
                        {stock.addedBy && (
                          <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                            {stock.addedBy}
                          </span>
                        )}
                        <span className="text-xs text-gray-400 ml-auto">タップして編集 ›</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* CALENDAR TAB */}
      {activeTab === 'calendar' && (
        <div>
          {/* Nav */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  if (calMonth === 1) { setCalMonth(12); setCalYear((y) => y - 1); }
                  else setCalMonth((m) => m - 1);
                }}
                className="w-8 h-8 rounded-lg border border-black/10 flex items-center justify-center text-gray-500 hover:bg-gray-50 transition-colors"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
              <span className="font-bold text-gray-800 text-sm">{calYear}年 {months[calMonth - 1]}</span>
              <button
                onClick={() => {
                  if (calMonth === 12) { setCalMonth(1); setCalYear((y) => y + 1); }
                  else setCalMonth((m) => m + 1);
                }}
                className="w-8 h-8 rounded-lg border border-black/10 flex items-center justify-center text-gray-500 hover:bg-gray-50 transition-colors"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            </div>
            {/* Legend */}
            <div className="flex items-center gap-3 text-xs text-gray-500">
              <span className="flex items-center gap-1">
                <span className="w-3 h-3 rounded-sm bg-yellow-100 border border-yellow-300 inline-block" />
                期限
              </span>
            </div>
          </div>

          {/* Day labels */}
          <div className="grid grid-cols-7 gap-0.5 mb-0.5">
            {days.map((d) => (
              <div key={d} className="text-center text-xs text-gray-400 py-1 font-medium">{d}</div>
            ))}
          </div>

          {/* Grid */}
          <div className="grid grid-cols-7 gap-0.5">
            {calCells().map((cell) => {
              if (cell.empty) {
                return <div key={cell.key} className="min-h-[52px]" />;
              }
              return (
                <div
                  key={cell.key}
                  className={`bg-white border rounded-lg p-1 min-h-[52px] text-xs ${
                    cell.isToday
                      ? 'border-[#2d5f3f] bg-[#e8f0eb]'
                      : 'border-black/5'
                  }`}
                >
                  <div className={`font-medium mb-0.5 ${cell.isToday ? 'text-[#2d5f3f]' : 'text-gray-400'}`}>
                    {cell.d}
                  </div>
                  {cell.deadlines.map((s) => (
                    <div
                      key={s.id}
                      className="text-[9px] bg-yellow-100 text-yellow-700 rounded px-1 py-0.5 mb-0.5 truncate font-medium"
                    >
                      {s.name}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center sm:p-4"
          onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}
        >
          <div className="bg-white w-full max-w-md rounded-t-2xl sm:rounded-2xl max-h-[92dvh] overflow-y-auto">
            <div className="p-5">
              {/* Modal header */}
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-bold text-gray-800">
                  {editingId ? '銘柄を編集' : '銘柄を追加'}
                </h2>
                <button
                  onClick={closeModal}
                  className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 hover:bg-gray-200 transition-colors"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>

              <form onSubmit={handleSave}>
                {/* Photo upload area */}
                <div
                  className="border-2 border-dashed border-gray-200 rounded-xl mb-4 overflow-hidden cursor-pointer min-h-[80px] flex items-center justify-center bg-gray-50 hover:bg-gray-100 transition-colors"
                  onClick={() => photoInputRef.current?.click()}
                >
                  {photoCompressing ? (
                    <div className="flex flex-col items-center gap-2 py-4">
                      <div className="w-6 h-6 border-2 border-gray-300 border-t-[#2d5f3f] rounded-full animate-spin-custom" />
                      <span className="text-xs text-gray-400">圧縮中…</span>
                    </div>
                  ) : (() => {
                    const existingPhoto = editingId ? stocks.find((s) => s.id === editingId)?.photo : null;
                    const src = pendingPhoto !== undefined ? pendingPhoto : existingPhoto;
                    if (src) {
                      return (
                        <img
                          src={src}
                          alt="プレビュー"
                          className="w-full max-h-40 object-cover rounded-xl"
                        />
                      );
                    }
                    return (
                      <div className="flex flex-col items-center gap-1 py-5">
                        <svg viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="1.5" className="w-7 h-7">
                          <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
                          <circle cx="12" cy="13" r="4" />
                        </svg>
                        <span className="text-xs text-gray-400">優待券の写真を追加（任意）</span>
                      </div>
                    );
                  })()}
                </div>
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => handlePhotoChange(e.target.files[0])}
                />

                {/* Name */}
                <div className="mb-3">
                  <label className="block text-xs text-gray-500 mb-1 font-medium">銘柄名 *</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="例：イオン"
                    required
                    className="w-full px-3 py-2.5 text-sm border border-black/15 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#2d5f3f]"
                  />
                </div>

                {/* Content */}
                <div className="mb-3">
                  <label className="block text-xs text-gray-500 mb-1 font-medium">優待内容</label>
                  <textarea
                    value={form.content}
                    onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
                    placeholder="例：お買い物割引券3,000円分"
                    rows={3}
                    className="w-full px-3 py-2.5 text-sm border border-black/15 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#2d5f3f] resize-y"
                  />
                </div>

                {/* Expiry */}
                <div className="mb-3">
                  <label className="block text-xs text-gray-500 mb-1 font-medium">使用期限</label>
                  <input
                    type="date"
                    value={form.expiry}
                    onChange={(e) => setForm((f) => ({ ...f, expiry: e.target.value }))}
                    className="w-full px-3 py-2.5 text-sm border border-black/15 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#2d5f3f]"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3 mb-3">
                  {/* Priority */}
                  <div>
                    <label className="block text-xs text-gray-500 mb-1 font-medium">優先度</label>
                    <select
                      value={form.priority}
                      onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}
                      className="w-full px-3 py-2.5 text-sm border border-black/15 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#2d5f3f] bg-white"
                    >
                      <option value="high">高</option>
                      <option value="mid">中</option>
                      <option value="low">低</option>
                    </select>
                  </div>

                  {/* Added by */}
                  <div>
                    <label className="block text-xs text-gray-500 mb-1 font-medium">追加者</label>
                    <select
                      value={form.addedBy}
                      onChange={(e) => setForm((f) => ({ ...f, addedBy: e.target.value }))}
                      className="w-full px-3 py-2.5 text-sm border border-black/15 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#2d5f3f] bg-white"
                    >
                      {USERS.map((u) => (
                        <option key={u} value={u}>{u}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-2 mt-4">
                  <button
                    type="button"
                    onClick={closeModal}
                    className="px-4 py-2.5 text-sm border border-black/15 rounded-xl text-gray-600 hover:bg-gray-50 transition-colors"
                  >
                    キャンセル
                  </button>
                  <button
                    type="submit"
                    disabled={submitting || !form.name.trim()}
                    className="flex-1 py-2.5 bg-[#2d5f3f] text-white rounded-xl font-medium text-sm disabled:opacity-50 hover:bg-[#24502f] transition-colors"
                  >
                    {submitting
                      ? editingId ? '保存中…' : '追加中…'
                      : editingId ? '保存する' : '追加する'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Photo viewer */}
      {viewerSrc && (
        <div
          className="fixed inset-0 bg-black/90 z-[60] flex items-center justify-center"
          onClick={() => setViewerSrc(null)}
        >
          <button
            className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/20 flex items-center justify-center text-white text-lg hover:bg-white/30 transition-colors"
            onClick={() => setViewerSrc(null)}
          >
            ✕
          </button>
          <img
            src={viewerSrc}
            alt="優待券写真"
            className="max-w-[92vw] max-h-[84vh] rounded-xl object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
