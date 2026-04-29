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

  const refresh = useCallback(async () => {
    lastRefreshAt.current = Date.now();
    const u = await fetchMe();
    setUser(u);
    setIsLoadingAuth(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

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
