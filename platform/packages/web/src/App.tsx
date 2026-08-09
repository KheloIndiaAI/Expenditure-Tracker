import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './lib/auth.tsx';
import { AppShell } from './components/AppShell.tsx';
import { PageSkeleton } from './components/States.tsx';
import { Login } from './pages/Login.tsx';

// Code-split every page — the Command Center must first-paint in < 2s (NFR-1).
const Home = lazy(() => import('./pages/Home.tsx').then((m) => ({ default: m.Home })));
const CommandCenter = lazy(() => import('./pages/CommandCenter.tsx').then((m) => ({ default: m.CommandCenter })));
const FinancialOverview = lazy(() => import('./pages/FinancialOverview.tsx').then((m) => ({ default: m.FinancialOverview })));
const HeadAnalysis = lazy(() => import('./pages/HeadAnalysis.tsx').then((m) => ({ default: m.HeadAnalysis })));
const SubverticalAnalysis = lazy(() => import('./pages/SubverticalAnalysis.tsx').then((m) => ({ default: m.SubverticalAnalysis })));
const SubCategoryAnalysis = lazy(() => import('./pages/SubCategoryAnalysis.tsx').then((m) => ({ default: m.SubCategoryAnalysis })));
const RegionalCentre = lazy(() => import('./pages/RegionalCentre.tsx').then((m) => ({ default: m.RegionalCentre })));
const Grantee = lazy(() => import('./pages/Grantee.tsx').then((m) => ({ default: m.Grantee })));
const Trend = lazy(() => import('./pages/Trend.tsx').then((m) => ({ default: m.Trend })));
const ExceptionCenter = lazy(() => import('./pages/ExceptionCenter.tsx').then((m) => ({ default: m.ExceptionCenter })));
const TransactionExplorer = lazy(() => import('./pages/TransactionExplorer.tsx').then((m) => ({ default: m.TransactionExplorer })));
const UploadCenter = lazy(() => import('./pages/UploadCenter.tsx').then((m) => ({ default: m.UploadCenter })));
const DataQuality = lazy(() => import('./pages/DataQuality.tsx').then((m) => ({ default: m.DataQuality })));
const VersionHistory = lazy(() => import('./pages/VersionHistory.tsx').then((m) => ({ default: m.VersionHistory })));
const SettingsPage = lazy(() => import('./pages/Settings.tsx').then((m) => ({ default: m.SettingsPage })));
const Help = lazy(() => import('./pages/Help.tsx').then((m) => ({ default: m.Help })));

export function App() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-page">
        <div className="skeleton h-2 w-48" aria-label="Loading session" />
      </div>
    );
  }

  if (!user) {
    if (location.pathname === '/login') return <Login />;
    return <Navigate to="/login" replace />;
  }

  if (location.pathname === '/login') return <Navigate to="/" replace />;

  return (
    <AppShell>
      <Suspense fallback={<PageSkeleton />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/command-center" element={<CommandCenter />} />
          <Route path="/overview" element={<FinancialOverview />} />
          <Route path="/head" element={<HeadAnalysis />} />
          <Route path="/subvertical" element={<SubverticalAnalysis />} />
          <Route path="/sub-category" element={<SubCategoryAnalysis />} />
          <Route path="/regional-centre" element={<RegionalCentre />} />
          <Route path="/grantee" element={<Grantee />} />
          <Route path="/trend" element={<Trend />} />
          <Route path="/exceptions" element={<ExceptionCenter />} />
          <Route path="/transactions" element={<TransactionExplorer />} />
          <Route path="/upload" element={<UploadCenter />} />
          <Route path="/quality" element={<DataQuality />} />
          <Route path="/versions" element={<VersionHistory />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/help" element={<Help />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </AppShell>
  );
}
