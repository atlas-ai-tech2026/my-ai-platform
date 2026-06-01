import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { pagesConfig } from './pages.config'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import LoginModal from '@/components/auth/LoginModal';
import AdminPanel from '@/pages/AdminPanel';
import AdminGuard from '@/components/admin/AdminGuard';
import NodeLanding from '@/pages/NodeLanding';
import NodeCanvas from '@/pages/NodeCanvas';

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
  // Note: we intentionally do NOT block the public site on auth state.
  // Unauthenticated visitors can browse Explore/Image/Video/etc.; the
  // sign-up wall fires only when they try to actually generate.
  return (
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
      <Route path="/node" element={<NodeLanding />} />
      <Route path="/node/:spaceId" element={<NodeCanvas />} />
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
