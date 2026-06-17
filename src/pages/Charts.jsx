import React, { useState, useEffect } from 'react';
import { db } from '../firebase.js';
import { collection, onSnapshot } from 'firebase/firestore';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell,
} from 'recharts';

const PIE_COLORS = ['#2d5f3f', '#c47c2b', '#6b4aa0', '#3b82f6', '#b83232', '#0ea5e9'];

const HOLDING_TYPE_LABEL = {
  '国内株式': '国内株式', '米国株式': '米国株式', '投資信託': '投資信託',
  '楽天・マネーファンド': 'MRF', '外貨建MMF': '外貨MMF',
  '国内債券': '国内債券', '外国債券': '外国債券', '金・プラチナ': '金・Pt',
};

function getLast6Months() {
  const months = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return months;
}

function getMonthLabel(yyyymm) {
  const [, m] = yyyymm.split('-');
  return `${parseInt(m, 10)}月`;
}

function formatMan(v) {
  if (v >= 10000) return `${Math.round(v / 10000)}万`;
  return String(v);
}

function formatJPY(n) {
  return new Intl.NumberFormat('ja-JP').format(Math.abs(n));
}

function DonutLegend({ data, total }) {
  return (
    <div className="flex-1 space-y-2 min-w-0">
      {data.map((item, i) => {
        const pct = total > 0 ? Math.round((item.value / total) * 100) : 0;
        return (
          <div key={i} className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
              <span className="text-xs text-gray-600 truncate">{item.name}</span>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <span className="text-xs text-gray-400">¥{formatJPY(item.value)}</span>
              <span className="text-xs font-bold text-gray-800 w-8 text-right">{pct}%</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function Charts() {
  const [transactions, setTransactions] = useState([]);
  const [cardStatements, setCardStatements] = useState([]);
  const [assets, setAssets] = useState([]);
  const [portfolios, setPortfolios] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubs = [];
    unsubs.push(onSnapshot(collection(db, 'transactions'), (snap) => {
      setTransactions(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    }, () => {}));
    unsubs.push(onSnapshot(collection(db, 'cardStatements'), (snap) => {
      setCardStatements(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    }, () => {}));
    unsubs.push(onSnapshot(collection(db, 'assets'), (snap) => {
      setAssets(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }, () => { setLoading(false); }));
    unsubs.push(onSnapshot(collection(db, 'stockPortfolio'), (snap) => {
      const map = {};
      snap.docs.forEach((d) => { map[d.id] = d.data(); });
      setPortfolios(map);
    }, () => {}));
    return () => unsubs.forEach((u) => u());
  }, []);

  const getEffectiveAmount = (t) => {
    if (t.excludeFromBalance) return 0;
    const stmt = t.cardStatementId ? cardStatements.find((s) => s.id === t.cardStatementId) : null;
    if (stmt) {
      const excluded = (stmt.items || []).filter((i) => i.excludeFromBalance).reduce((s, i) => s + (i.amount || 0), 0);
      return Math.max(0, (t.amount || 0) - excluded);
    }
    return t.amount || 0;
  };

  const months = getLast6Months();
  const monthlyData = months.map((month) => {
    const monthTx = transactions.filter((t) => t.date?.startsWith(month));
    const income = monthTx.filter((t) => t.type === 'income').reduce((s, t) => s + getEffectiveAmount(t), 0);
    const expense = monthTx.filter((t) => t.type === 'expense').reduce((s, t) => s + getEffectiveAmount(t), 0);
    const savings = income - expense;
    const rate = income > 0 ? Math.round((savings / income) * 100) : null;
    return { month: getMonthLabel(month), 収入: income, 支出: expense, 貯蓄率: rate };
  });

  const hasMonthlyData = monthlyData.some((d) => d.収入 > 0 || d.支出 > 0);
  const hasSavingsData = monthlyData.some((d) => d.貯蓄率 !== null);

  const totalAssets = assets.reduce((s, a) => s + (a.amount || 0), 0);
  const bankSum = assets.filter((a) => a.type === 'bank').reduce((s, a) => s + (a.amount || 0), 0);
  const secSum = assets.filter((a) => a.type !== 'bank').reduce((s, a) => s + (a.amount || 0), 0);
  const assetPieData = [
    bankSum > 0 && { name: '銀行口座', value: bankSum },
    secSum > 0 && { name: '証券口座', value: secSum },
  ].filter(Boolean);

  const allHoldings = Object.values(portfolios).flatMap((p) => p.items || []);
  const holdingTypeMap = {};
  allHoldings.forEach((item) => {
    holdingTypeMap[item.type] = (holdingTypeMap[item.type] || 0) + item.currentValueJPY;
  });
  const securitiesPieData = Object.entries(holdingTypeMap)
    .map(([name, value]) => ({ name: HOLDING_TYPE_LABEL[name] || name, value }))
    .sort((a, b) => b.value - a.value);
  const securitiesTotal = securitiesPieData.reduce((s, d) => s + d.value, 0);

  const tooltipStyle = {
    borderRadius: '12px',
    border: '1px solid rgba(0,0,0,0.08)',
    boxShadow: '0 4px 12px rgba(0,0,0,0.10)',
    fontSize: '12px',
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-64 p-8">
        <div className="w-8 h-8 border-2 border-gray-200 border-t-[#2d5f3f] rounded-full animate-spin-custom mx-auto" />
      </div>
    );
  }

  return (
    <div className="p-5 max-w-2xl mx-auto">
      <div className="mb-5">
        <h1 className="text-lg font-bold text-gray-800">グラフ</h1>
      </div>

      {/* 月別収支推移 */}
      <div className="bg-white rounded-2xl shadow-sm border border-black/5 p-5 mb-4">
        <h2 className="text-sm font-bold text-gray-800 mb-4">月別収支推移</h2>
        {!hasMonthlyData ? (
          <p className="text-sm text-gray-400 text-center py-8">収支データがありません</p>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={monthlyData} barGap={2} barCategoryGap="30%">
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                <YAxis
                  tickFormatter={formatMan}
                  tick={{ fontSize: 10, fill: '#9ca3af' }}
                  axisLine={false} tickLine={false} width={36}
                />
                <Tooltip
                  formatter={(value, name) => [`¥${formatJPY(value)}`, name]}
                  contentStyle={tooltipStyle}
                  cursor={{ fill: 'rgba(0,0,0,0.04)' }}
                />
                <Bar dataKey="収入" fill="#2d5f3f" radius={[4, 4, 0, 0]} maxBarSize={36} />
                <Bar dataKey="支出" fill="#b83232" radius={[4, 4, 0, 0]} maxBarSize={36} />
              </BarChart>
            </ResponsiveContainer>
            <div className="flex items-center justify-center gap-5 mt-2">
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-sm bg-[#2d5f3f]" />
                <span className="text-xs text-gray-500">収入</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-sm bg-[#b83232]" />
                <span className="text-xs text-gray-500">支出</span>
              </div>
            </div>
          </>
        )}
      </div>

      {/* 月別貯蓄率 */}
      <div className="bg-white rounded-2xl shadow-sm border border-black/5 p-5 mb-4">
        <h2 className="text-sm font-bold text-gray-800 mb-4">月別貯蓄率</h2>
        {!hasSavingsData ? (
          <p className="text-sm text-gray-400 text-center py-8">収支データがありません</p>
        ) : (
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={monthlyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
              <YAxis
                tickFormatter={(v) => `${v}%`}
                tick={{ fontSize: 10, fill: '#9ca3af' }}
                axisLine={false} tickLine={false} width={36}
                domain={[0, 100]}
              />
              <Tooltip
                formatter={(value) => [value !== null ? `${value}%` : 'データなし', '貯蓄率']}
                contentStyle={tooltipStyle}
              />
              <Line
                type="monotone" dataKey="貯蓄率"
                stroke="#c47c2b" strokeWidth={2.5}
                dot={{ fill: '#c47c2b', r: 4, strokeWidth: 0 }}
                activeDot={{ r: 6 }}
                connectNulls={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* 総資産内訳 */}
      <div className="bg-white rounded-2xl shadow-sm border border-black/5 p-5 mb-4">
        <h2 className="text-sm font-bold text-gray-800 mb-1">総資産内訳</h2>
        <p className="text-xs text-gray-400 mb-4">総額 ¥{formatJPY(totalAssets)}</p>
        {assetPieData.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">資産データがありません</p>
        ) : (
          <div className="flex items-center gap-4">
            <div className="flex-shrink-0" style={{ width: 140, height: 140 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={assetPieData} cx="50%" cy="50%"
                    innerRadius={45} outerRadius={68}
                    dataKey="value" strokeWidth={0}
                  >
                    {assetPieData.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
            <DonutLegend data={assetPieData} total={totalAssets} />
          </div>
        )}
      </div>

      {/* 証券ポートフォリオ内訳 */}
      <div className="bg-white rounded-2xl shadow-sm border border-black/5 p-5 mb-4">
        <h2 className="text-sm font-bold text-gray-800 mb-1">証券ポートフォリオ内訳</h2>
        <p className="text-xs text-gray-400 mb-4">評価額合計 ¥{formatJPY(securitiesTotal)}</p>
        {securitiesPieData.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">楽天証券のCSVをインポートすると表示されます</p>
        ) : (
          <div className="flex items-center gap-4">
            <div className="flex-shrink-0" style={{ width: 140, height: 140 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={securitiesPieData} cx="50%" cy="50%"
                    innerRadius={45} outerRadius={68}
                    dataKey="value" strokeWidth={0}
                  >
                    {securitiesPieData.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
            <DonutLegend data={securitiesPieData} total={securitiesTotal} />
          </div>
        )}
      </div>
    </div>
  );
}
