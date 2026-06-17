import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Kakeibo from './pages/Kakeibo.jsx';
import Charts from './pages/Charts.jsx';
import Assets from './pages/Assets.jsx';
import Yutai from './pages/Yutai.jsx';
import FPChat from './pages/FPChat.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="kakeibo" element={<Kakeibo />} />
        <Route path="charts" element={<Charts />} />
        <Route path="assets" element={<Assets />} />
        <Route path="yutai" element={<Yutai />} />
        <Route path="fp" element={<FPChat />} />
      </Route>
    </Routes>
  );
}
