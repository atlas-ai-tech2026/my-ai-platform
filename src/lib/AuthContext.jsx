import React, { createContext, useState, useContext, useEffect, useCallback, useRef } from 'react';
import { VOXEL_TOKEN_KEY } from '@/lib/adminApi';

// Single source of truth for the public site's auth state.
//
// Responsibilities:
//   1. Read the JWT from localStorage on mount and resolve the current user
//      via GET /api/auth/me (the same endpoint the admin panel uses).
//   2. Hold the global "auth modal" state so that any component — Navbar,
//      Image/Video generate handlers, etc. — can pop the sign-up/sign-in
//      modal with `openAuthModal('signup' | 'login')` instead of each page
//      re-implementing its own modal state.
//   3. Expose `handleAuthSuccess()` for the modal to call after a successful
//      register/login so the rest of the app re-reads /me and the navbar
//      flips from "Sign Up / Login" to the user's email + Sign Out.
//
// Previous version called dead `base44.auth.*` SDK methods (Base44 was
// removed from the project) which silently no-op'd, so signups appeared to
// "do nothing" — modal closed but the navbar never updated.

const AuthContext = createContext(null);

async function fetchMe() {
  const token = localStorage.getItem(VOXEL_TOKEN_KEY);
  if (!token) return null;
  let res;
  try {
    res = await fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (err) {
    console.error('[auth] /me network error:', err.message);
    return null;
  }
  if (res.status === 401 || res.status === 403) {
    // Token invalid/expired — drop it so the user sees the unauthenticated UI.
    localStorage.removeItem(VOXEL_TOKEN_KEY);
    return null;
  }
  if (!res.ok) {
    console.error('[auth] /me unexpected status:', res.status);
    return null;
  }
  const data = await res.json().catch(() => null);
  return data?.user || null;
}

// Minimum gap between two `refresh()` calls triggered by the focus
// listener. Without this, alt-tabbing back and forth would hammer
// /api/auth/me. Manual `refresh()` calls (post-generate, after login)
// bypass the throttle.
const FOCUS_REFRESH_THROTTLE_MS = 10_000;

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  // 'login' | 'signup' | null
  const [authModalMode, setAuthModalMode] = useState(null);
  const lastRefreshAt = useRef(0);

  const [googleError, setGoogleError] = useState('');

  const refresh = useCallback(async () => {
    lastRefreshAt.current = Date.now();
    const u = await fetchMe();
    setUser(u);
    setIsLoadingAuth(false);
  }, []);

  // Returning from "Sign in with Google". The callback put the session in a
  // short-lived httpOnly cookie and sent the browser back with ?google=1 — the
  // token deliberately never travels in the URL, where it would be recorded in
  // browser history, Referer headers and any proxy log on the way.
  //
  // Runs BEFORE the normal refresh so the first paint after signing in already
  // shows the user as logged in.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const authError = params.get('auth_error');
    const isGoogleReturn = params.get('google') === '1';
    if (!authError && !isGoogleReturn) { refresh(); return; }

    // Strip the marker so a refresh or a shared link cannot replay it.
    const clean = new URL(window.location.href);
    clean.searchParams.delete('google');
    clean.searchParams.delete('auth_error');
    window.history.replaceState({}, '', clean.pathname + clean.search + clean.hash);

    if (authError) {
      setGoogleError(
        authError === 'google_cancelled' ? 'Google sign-in was cancelled.'
        : authError === 'account_banned' ? 'That account has been suspended.'
        : authError === 'google_unavailable' ? 'Google sign-in is not available right now.'
        : authError === 'microsoft_cancelled' ? 'Microsoft sign-in was cancelled.'
        : authError === 'microsoft_unavailable' ? 'Microsoft sign-in is not available right now.'
        // Refused on purpose: Entra ID does not verify email addresses, so
        // attaching to an existing account on an email match would be an
        // account-takeover route (nOAuth). Tell them what actually works.
        : authError === 'microsoft_email_taken' ? 'An account already uses that email address. Sign in with your password or Google, and we can connect Microsoft afterwards.'
        : authError === 'microsoft_failed' ? 'Microsoft sign-in did not complete. Please try again.'
        : 'Google sign-in did not complete. Please try again.'
      );
      refresh();
      return;
    }

    (async () => {
      try {
        const res = await fetch('/api/auth/google/complete', {
          method: 'POST',
          credentials: 'include',
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.token) {
          localStorage.setItem(VOXEL_TOKEN_KEY, data.token);
        } else {
          setGoogleError(data.error || 'Google sign-in did not complete. Please try again.');
        }
      } catch {
        setGoogleError('Google sign-in did not complete. Please try again.');
      } finally {
        refresh();
      }
    })();
  }, [refresh]);

  // Pick up out-of-band balance changes (admin granted credits, generate on
  // another tab, etc.) the next time the user tabs back to this window.
  // Throttled so rapid focus-blur flicker doesn't spam /me.
  useEffect(() => {
    const onFocus = () => {
      const sinceLast = Date.now() - lastRefreshAt.current;
      if (sinceLast >= FOCUS_REFRESH_THROTTLE_MS) refresh();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  const openAuthModal = useCallback((mode = 'login') => {
    setAuthModalMode(mode === 'signup' ? 'signup' : 'login');
  }, []);

  const closeAuthModal = useCallback(() => {
    setAuthModalMode(null);
  }, []);

  // The modal calls this after a successful register/login — it has already
  // stashed the JWT in localStorage. We re-fetch /me so the user object
  // reflects server-side fields (credits, role, package) instead of trusting
  // anything the modal passed us.
  const handleAuthSuccess = useCallback(async () => {
    await refresh();
    setAuthModalMode(null);
  }, [refresh]);

  const logout = useCallback(() => {
    localStorage.removeItem(VOXEL_TOKEN_KEY);
    localStorage.removeItem('voxel_user');
    // The base44 client keeps an offline fallback cache keyed `voxel_<entity>`
    // that is NOT namespaced by user. Clearing it on logout stops the previous
    // account's history from being served to the next person who signs in on
    // this browser.
    localStorage.removeItem('voxel_GenerationHistory');
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated: !!user,
      isLoadingAuth,
      authModalMode,
      openAuthModal,
      closeAuthModal,
      handleAuthSuccess,
      refresh,
      logout,
      // Surfaced so the login modal can show why a Google round trip failed
      // instead of the user landing back on the site with no explanation.
      googleError,
      clearGoogleError: () => setGoogleError(''),
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
