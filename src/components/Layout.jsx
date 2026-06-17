import React, { useState, useEffect } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { db } from '../firebase.js';
import { enableNetwork, disableNetwork } from 'firebase/firestore';

const NAV_ITEMS = [
  {
    to: '/dashboard',
    label: 'ダッシュボード',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5">
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
    ),
  },
  {
    to: '/kakeibo',
    label: '家計簿',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5">
        <path d="M9 14l2 2 4-4" />
        <path d="M12 3C8.5 3 6 5.5 6 9c0 3 2 5.5 6 9 4-3.5 6-6 6-9 0-3.5-2.5-6-6-6z" />
      </svg>
    ),
  },
  {
    to: '/charts',
    label: 'グラフ',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5">
        <line x1="18" y1="20" x2="18" y2="10" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="6" y1="20" x2="6" y2="14" />
        <line x1="2" y1="20" x2="22" y2="20" />
      </svg>
    ),
  },
  {
    to: '/assets',
    label: '資産',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5">
        <rect x="2" y="7" width="20" height="14" rx="2" />
        <path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2" />
        <line x1="12" y1="12" x2="12" y2="16" />
        <line x1="10" y1="14" x2="14" y2="14" />
      </svg>
    ),
  },
  {
    to: '/yutai',
    label: '優待',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5">
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <path d="M8 21h8M12 17v4" />
        <path d="M7 8h10M7 11h7" />
      </svg>
    ),
  },
];

export default function Layout() {
  const [syncStatus, setSyncStatus] = useState('syncing'); // 'synced' | 'syncing' | 'error'
  const location = useLocation();

  useEffect(() => {
    // Monitor online/offline status
    const handleOnline = () => {
      setSyncStatus('synced');
      enableNetwork(db).catch(() => {});
    };
    const handleOffline = () => {
      setSyncStatus('error');
      disableNetwork(db).catch(() => {});
    };

    if (navigator.onLine) {
      setSyncStatus('synced');
    } else {
      setSyncStatus('error');
    }

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const syncDotClass =
    syncStatus === 'synced'
      ? 'bg-green-500'
      : syncStatus === 'syncing'
      ? 'bg-yellow-500 animate-pulse-dot'
      : 'bg-red-500';

  const syncLabel =
    syncStatus === 'synced' ? '同期済み' : syncStatus === 'syncing' ? '同期中…' : 'オフライン';

  return (
    <div className="flex flex-col min-h-dvh lg:flex-row">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex flex-col w-56 bg-white border-r border-black/10 fixed top-0 left-0 bottom-0 z-40">
        {/* Logo */}
        <div className="flex items-center gap-2 px-5 py-4 border-b border-black/10">
          <svg viewBox="0 0 24 24" fill="none" stroke="#2d5f3f" strokeWidth="2" className="w-6 h-6 flex-shrink-0">
            <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
            <polyline points="9 22 9 12 15 12 15 22" />
          </svg>
          <span className="font-bold text-[#2d5f3f] text-sm leading-tight">家計ポータル</span>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-4 px-3">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg mb-1 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-[#e8f0eb] text-[#2d5f3f]'
                    : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
                }`
              }
            >
              {item.icon}
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Sync status */}
        <div className="px-5 py-3 border-t border-black/10 flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${syncDotClass}`} />
          <span className="text-xs text-gray-400">{syncLabel}</span>
        </div>
      </aside>

      {/* Main area */}
      <div className="flex-1 flex flex-col lg:ml-56">
        {/* Mobile Header */}
        <header className="lg:hidden bg-white border-b border-black/10 px-4 py-3 flex items-center justify-between sticky top-0 z-30">
          <div className="flex items-center gap-2">
            <svg viewBox="0 0 24 24" fill="none" stroke="#2d5f3f" strokeWidth="2" className="w-5 h-5">
              <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
            <span className="font-bold text-[#2d5f3f] text-sm">家計ポータル</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className={`w-2 h-2 rounded-full ${syncDotClass}`} />
            <span className="text-xs text-gray-400">{syncLabel}</span>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 pb-20 lg:pb-0">
          <Outlet />
        </main>
      </div>

      {/* Mobile Bottom Nav */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-black/10 z-40 flex">
        {NAV_ITEMS.map((item) => {
          const isActive = location.pathname === item.to;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={`flex-1 flex flex-col items-center gap-0.5 py-2 px-1 text-center transition-colors ${
                isActive ? 'text-[#2d5f3f]' : 'text-gray-400'
              }`}
            >
              {item.icon}
              <span className="text-[10px] font-medium leading-tight">{item.label}</span>
            </NavLink>
          );
        })}
      </nav>
    </div>
  );
}
