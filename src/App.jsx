import { Suspense, lazy } from 'react';
import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { pagesConfig } from './pages.config'
import { BrowserRouter as Router, Route, Routes, useLocation } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import LoginModal from '@/components/auth/LoginModal';
import AdminGuard from '@/components/admin/AdminGuard';
import ResetPassword from '@/pages/ResetPassword';

// Heavy standalone pages are lazy like everything in pages.config — the
// admin panel and node canvas never ship to ordinary visitors' first load.
const AdminPanel = lazy(() => import('@/pages/AdminPanel'));
const NodeLanding = lazy(() => import('@/pages/NodeLanding'));
const NodeCanvas = lazy(() => import('@/pages/NodeCanvas'));
// Dev-only measuring instrument for the Whisper decision (#82). Lazy so the
// 1 MB of onnxruntime it pulls in NEVER lands in a chunk a customer loads —
// the page itself also returns null off a dev host, so the two are belt and
// braces rather than one gate.
const SpeechLab = lazy(() => import('@/pages/SpeechLab'));
// The first-run questions. Lazy, because it must never be part of what a
// RETURNING customer downloads — they will never see it again.
const FirstRunGate = lazy(() => import('@/components/onboarding/FirstRunGate'));

// Route-chunk loading state: plain dark screen, matches the app background
// so navigation feels like a beat of black rather than a flash of white.
const RouteFallback = () => (
  <div className="min-h-screen bg-background" aria-busy="true" />
);

// Obscure URL for the admin panel — security through obscurity is NOT a real
// defense, but it does keep automated scanners from probing /admin. Real
// security is enforced in AdminGuard (JWT + role check) and on the server
// (every /api/admin/* route requires role='admin'). Keep this string
// unguessable enough that it doesn't appear in any sitemap or public link.
const ADMIN_ROUTE = '/x7k9-control-panel-mh2024';

const { Pages, Layout, mainPage } = pagesConfig;
const mainPageKey = mainPage ?? Object.keys(Pages)[0];
const MainPage = mainPageKey ? Pages[mainPageKey] : <></>;

const LayoutWrapper = ({ children, currentPageName }) => Layout ?
  <Layout currentPageName={currentPageName}>{children}</Layout>
  : <>{children}</>;

// One LoginModal mounted at app level, controlled by AuthContext. Anywhere
// in the tree that calls `useAuth().openAuthModal('signup' | 'login')` will
// pop this modal — including Image/Video generate handlers and the navbar.
const GlobalAuthModal = () => {
  const { authModalMode, closeAuthModal, handleAuthSuccess } = useAuth();
  if (!authModalMode) return null;
  return (
    <LoginModal
      initialMode={authModalMode}
      onClose={closeAuthModal}
      onSuccess={handleAuthSuccess}
    />
  );
};

const AuthenticatedApp = () => {
  // Read here rather than inside FirstRunGate: this component is already
  // inside <Router>, and keeping the decision at the mount point means the
  // gate itself stays a plain "should this customer be asked" question.
  const { pathname } = useLocation();
  // Note: we intentionally do NOT block the public site on auth state.
  // Unauthenticated visitors can browse Explore/Image/Video/etc.; the
  // sign-up wall fires only when they try to actually generate.
  return (
    <Suspense fallback={<RouteFallback />}>
    {/* ── FIRST RUN ────────────────────────────────────────────────────
        Outside <Routes> on purpose: the questions are asked once, wherever
        the customer happens to land, and are not a page you can navigate to
        or link somebody to. It decides for itself whether to render, and
        renders nothing at all for anyone who has already answered.

        ── EXCEPT THE CONTROL PANEL, AND THAT IS NOT A DETAIL ─────────────
        On dev the flow is forced open on EVERY page load so it can be tested
        repeatedly. The admin route lives inside <Routes>, so without this
        the survey painted over the whole control panel — zIndex 9000 against
        the panel's 1000 — and the only way past it was to press Skip.

        Which would have DESTROYED the answers being looked at: a skip writes
        __skipped for every question on that screen, and the merge is keyed by
        question id, so a real "A Voxel workshop" became "__skipped". The
        Audience tab would then have read "0 answered · 1 skipped (100%)" and
        the only sane conclusion from that screen is that the feature records
        nothing. The act of going to read the results would have erased them.

        Found by attacking the flow before Amr tested it. Note that
        first-run-reachable.test.jsx was GREEN throughout — it asserts the gate
        is mounted outside <Routes>, which is exactly what caused this. A guard
        can be satisfied by the thing it was meant to prevent. */}
    {pathname !== ADMIN_ROUTE && <FirstRunGate />}
    <Routes>
      <Route path="/" element={
        <LayoutWrapper currentPageName={mainPageKey}>
          <MainPage />
        </LayoutWrapper>
      } />
      {/* Admin panel — does NOT use the LayoutWrapper (no shared chrome).
          AdminGuard renders its own login form when no admin token is
          present and redirects non-admins to "/". */}
      <Route path={ADMIN_ROUTE} element={
        <AdminGuard>
          <AdminPanel />
        </AdminGuard>
      } />
      {/* Voxel Node — full-screen canvas, no shared Layout chrome.
          Manual routes here because the auto pages.config mapping
          doesn't support the /:spaceId dynamic segment. */}
      {/* Password reset — PUBLIC and outside LayoutWrapper. The person using
          it is locked out by definition, so it cannot sit behind a login, and
          it should not show the signed-in chrome. Both steps live here: with
          ?token= it sets a new password, without one it asks for the link. */}
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/node" element={<NodeLanding />} />
      <Route path="/node/:spaceId" element={<NodeCanvas />} />
      <Route path="/speech-lab" element={<SpeechLab />} />
      {Object.entries(Pages).map(([path, Page]) => (
        <Route
          key={path}
          path={`/${path}`}
          element={
            <LayoutWrapper currentPageName={path}>
              <Page />
            </LayoutWrapper>
          }
        />
      ))}
      <Route path="*" element={<PageNotFound />} />
    </Routes>
    </Suspense>
  );
};


function App() {

  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <AuthenticatedApp />
          <GlobalAuthModal />
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App
