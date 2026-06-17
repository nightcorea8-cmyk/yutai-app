import React, { useState, useEffect, useRef, useCallback } from 'react';
import { db } from '../firebase.js';
import { collection, onSnapshot } from 'firebase/firestore';

function formatJPY(n) {
  return new Intl.NumberFormat('ja-JP').format(Math.abs(n));
}

const INITIAL_MSG = {
  role: 'assistant',
  content: 'こんにちは！AIファイナンシャルプランナーです。家計・貯蓄・投資についてなんでもご相談ください。',
};

const SUGGESTIONS = ['先月の家計を分析して', '貯蓄率を上げるコツは？', 'NISAはどう使うべき？', '老後に向けて何をすべき？'];

export default function FPChat() {
  const [messages, setMessages] = useState([INITIAL_MSG]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [transactions, setTransactions] = useState([]);
  const [cardStatements, setCardStatements] = useState([]);
  const [assets, setAssets] = useState([]);
  const [portfolios, setPortfolios] = useState({});
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    const unsubs = [
      onSnapshot(collection(db, 'transactions'), (s) => setTransactions(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => {}),
      onSnapshot(collection(db, 'cardStatements'), (s) => setCardStatements(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => {}),
      onSnapshot(collection(db, 'assets'), (s) => setAssets(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => {}),
      onSnapshot(collection(db, 'stockPortfolio'), (s) => {
        const map = {};
        s.docs.forEach((d) => { map[d.id] = d.data(); });
        setPortfolios(map);
      }, () => {}),
    ];
    return () => unsubs.forEach((u) => u());
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const buildContext = useCallback(() => {
    const now = new Date();
    const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const thisMonth = fmt(now);
    const lastMonth = fmt(new Date(now.getFullYear(), now.getMonth() - 1, 1));

    const getEff = (t) => {
      if (t.excludeFromBalance) return 0;
      const stmt = t.cardStatementId ? cardStatements.find((s) => s.id === t.cardStatementId) : null;
      if (stmt) {
        const ex = (stmt.items || []).filter((i) => i.excludeFromBalance).reduce((s, i) => s + (i.amount || 0), 0);
        return Math.max(0, (t.amount || 0) - ex);
      }
      return t.amount || 0;
    };

    const calc = (m) => {
      const tx = transactions.filter((t) => t.date?.startsWith(m));
      const income = tx.filter((t) => t.type === 'income').reduce((s, t) => s + getEff(t), 0);
      const expense = tx.filter((t) => t.type === 'expense').reduce((s, t) => s + getEff(t), 0);
      return { income, expense, balance: income - expense };
    };

    const last = calc(lastMonth);
    const cur = calc(thisMonth);
    const total = assets.reduce((s, a) => s + (a.amount || 0), 0);
    const bank = assets.filter((a) => a.type === 'bank').reduce((s, a) => s + (a.amount || 0), 0);
    const sec = assets.filter((a) => a.type !== 'bank').reduce((s, a) => s + (a.amount || 0), 0);
    const rate = last.income > 0 ? Math.round((last.balance / last.income) * 100) : null;

    const lines = [
      `先月（${lastMonth.replace('-', '年')}月）: 収入¥${formatJPY(last.income)} 支出¥${formatJPY(last.expense)} 収支¥${formatJPY(last.balance)}${rate !== null ? ` 貯蓄率${rate}%` : ''}`,
      `今月（${thisMonth.replace('-', '年')}月）: 収入¥${formatJPY(cur.income)} 支出¥${formatJPY(cur.expense)} 収支¥${formatJPY(cur.balance)}`,
      `総資産¥${formatJPY(total)}（銀行¥${formatJPY(bank)} 証券¥${formatJPY(sec)}）`,
    ];

    const bankAssets = assets.filter((a) => a.type === 'bank');
    if (bankAssets.length > 0) {
      lines.push('【銀行口座】');
      bankAssets.forEach((a) => {
        lines.push(`  ${a.name}: ¥${formatJPY(a.amount || 0)}`);
      });
    }

    const allHoldings = Object.values(portfolios).flatMap((p) => p.items || []);
    if (allHoldings.length > 0) {
      const byType = {};
      allHoldings.forEach((item) => {
        if (!byType[item.type]) byType[item.type] = [];
        byType[item.type].push(item);
      });
      lines.push('【株式・投資信託ポートフォリオ】');
      Object.entries(byType).forEach(([type, items]) => {
        lines.push(`  ${type}:`);
        items.forEach((item) => {
          const pnl = item.unrealizedPnL >= 0 ? `+¥${formatJPY(item.unrealizedPnL)}` : `-¥${formatJPY(Math.abs(item.unrealizedPnL))}`;
          lines.push(`    ${item.name}: ¥${formatJPY(item.currentValueJPY)}（評価損益${pnl}）`);
        });
      });
    }

    return lines.join('\n');
  }, [transactions, cardStatements, assets, portfolios]);

  const send = useCallback(async (text) => {
    const content = (text ?? input).trim();
    if (!content || loading) return;
    setInput('');

    const newMsgs = [...messages, { role: 'user', content }];
    setMessages(newMsgs);
    setLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newMsgs.slice(1), context: buildContext() }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
      setMessages([...newMsgs, { role: 'assistant', content: data.content }]);
    } catch (err) {
      setMessages([...newMsgs, { role: 'assistant', content: `エラー: ${err.message}` }]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [input, messages, loading, buildContext]);

  return (
    <div className="flex flex-col max-w-2xl mx-auto" style={{ height: 'calc(100dvh - 56px)' }}>
      {/* Header */}
      <div className="px-5 pt-5 pb-3 flex-shrink-0">
        <h1 className="text-lg font-bold text-gray-800">FP相談</h1>
        <p className="text-xs text-gray-400">AIファイナンシャルプランナーに相談する</p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 space-y-3 pb-2">
        {messages.map((msg, i) => (
          <div key={i} className={`flex items-end gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {msg.role === 'assistant' && (
              <div className="w-7 h-7 rounded-full bg-[#2d5f3f] flex items-center justify-center flex-shrink-0">
                <svg viewBox="0 0 24 24" fill="white" className="w-4 h-4">
                  <path d="M12 2C6.48 2 2 6.48 2 12c0 1.85.5 3.58 1.37 5.06L2 22l4.94-1.37A9.96 9.96 0 0012 22c5.52 0 10-4.48 10-10S17.52 2 12 2z"/>
                </svg>
              </div>
            )}
            <div className={`max-w-[78%] px-3.5 py-2.5 text-sm whitespace-pre-wrap leading-relaxed ${
              msg.role === 'user'
                ? 'bg-[#2d5f3f] text-white rounded-2xl rounded-br-sm'
                : 'bg-white border border-black/5 shadow-sm text-gray-800 rounded-2xl rounded-bl-sm'
            }`}>
              {msg.content}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex items-end gap-2 justify-start">
            <div className="w-7 h-7 rounded-full bg-[#2d5f3f] flex items-center justify-center flex-shrink-0">
              <svg viewBox="0 0 24 24" fill="white" className="w-4 h-4">
                <path d="M12 2C6.48 2 2 6.48 2 12c0 1.85.5 3.58 1.37 5.06L2 22l4.94-1.37A9.96 9.96 0 0012 22c5.52 0 10-4.48 10-10S17.52 2 12 2z"/>
              </svg>
            </div>
            <div className="bg-white border border-black/5 shadow-sm rounded-2xl rounded-bl-sm px-4 py-3 flex gap-1">
              {[0, 150, 300].map((d) => (
                <span key={d} className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: `${d}ms` }} />
              ))}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Suggestions */}
      {messages.length === 1 && !loading && (
        <div className="px-4 pb-2 flex gap-2 overflow-x-auto flex-shrink-0 scrollbar-none">
          {SUGGESTIONS.map((s) => (
            <button key={s} onClick={() => send(s)}
              className="flex-shrink-0 text-xs px-3 py-1.5 bg-white border border-black/10 rounded-full text-gray-600 hover:bg-gray-50 shadow-sm transition-colors">
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="flex-shrink-0 px-4 pb-5 pt-2 border-t border-black/5 bg-gray-50/50">
        <div className="flex items-end gap-2 bg-white rounded-2xl border border-black/10 shadow-sm px-3 py-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
            }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="メッセージを入力…"
            rows={1}
            className="flex-1 text-sm resize-none focus:outline-none bg-transparent text-gray-800 placeholder-gray-400"
            style={{ minHeight: '24px', maxHeight: '120px' }}
          />
          <button onClick={() => send()} disabled={!input.trim() || loading}
            className="w-8 h-8 rounded-xl bg-[#2d5f3f] flex items-center justify-center flex-shrink-0 disabled:opacity-40 hover:bg-[#24502f] transition-colors">
            <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4">
              <path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
        <p className="text-[10px] text-gray-300 text-center mt-1.5">AIの回答は参考情報です。重要な判断は専門家にご相談ください。</p>
      </div>
    </div>
  );
}
