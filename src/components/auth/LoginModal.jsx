import React, { useState } from 'react';
import { X, Mail, Eye, EyeOff, ArrowRight } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { adminApi, ApiError, VOXEL_TOKEN_KEY } from '@/lib/adminApi';

const font = '"DM Sans", sans-serif';

// SVG icons for providers
const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
    <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4"/>
    <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
    <path d="M3.964 10.707A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.707V4.961H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.039l3.007-2.332z" fill="#FBBC05"/>
    <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.961L3.964 7.293C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
  </svg>
);

const AppleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor">
    <path d="M12.293.667c.09.672-.196 1.354-.577 1.854-.394.513-1.05.912-1.7.862-.1-.648.21-1.32.572-1.802.384-.508 1.07-.91 1.705-.914zM14.87 12.47c-.196.433-.43.83-.715 1.196-.433.562-.883 1.12-1.503 1.126-.593.007-.784-.352-1.462-.349-.68.004-.885.356-1.51.356-.617 0-1.043-.536-1.507-1.106-1.295-1.592-2.075-4.198-1.1-6.52.47-1.108 1.38-1.85 2.34-1.866.619-.011 1.2.393 1.575.393.375 0 1.077-.486 1.813-.415.309.013 1.174.125 1.73.944l-.002.002c-.101.063-1.033.603-.944 1.8.101 1.42 1.246 1.894 1.285 1.908z"/>
  </svg>
);

const MicrosoftIcon = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
    <rect x="0" y="0" width="8.5" height="8.5" fill="#F25022"/>
    <rect x="9.5" y="0" width="8.5" height="8.5" fill="#7FBA00"/>
    <rect x="0" y="9.5" width="8.5" height="8.5" fill="#00A4EF"/>
    <rect x="9.5" y="9.5" width="8.5" height="8.5" fill="#FFB900"/>
  </svg>
);

export default function LoginModal({ onClose, initialMode = 'login' }) {
  // `view` controls layout (provider buttons vs email form).
  // `intent` is preserved across the view switch — when the user clicks
  // "Continue with Email" from the signup screen we still want the form to
  // act as a signup. Without this, clicking Email always reset to login.
  const [view, setView] = useState('options'); // 'options' | 'email'
  const [intent, setIntent] = useState(initialMode === 'signup' ? 'signup' : 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Apple sign-in removed per product decision (single mobile-keyboard
  // owner, no Apple Developer account). Google + Microsoft will be wired
  // in a later phase via OAuth — for now those buttons are placeholders.
  const providers = [
    { label: 'Continue with Google',    icon: <GoogleIcon />,    provider: 'google' },
    { label: 'Continue with Microsoft', icon: <MicrosoftIcon />, provider: 'microsoft' },
  ];

  const handleProviderLogin = (provider) => {
    // OAuth not yet wired. Show a friendly inline message rather than calling
    // the dead Base44 redirect, which silently no-ops on this site.
    setErrorMsg(`${provider[0].toUpperCase() + provider.slice(1)} sign-in is coming soon. Use email for now.`);
  };

  // Show the email form. The previous version called base44.auth.redirectToLogin
  // here, which was a leftover Base44 SDK call that does nothing on this site
  // — so clicking the button appeared to do nothing. Now it switches views
  // to render the email/password form already coded below.
  const handleEmailLogin = () => {
    setErrorMsg('');
    setSuccessMsg('');
    setView('email');
  };

  // Real submit handler. Hits our /api/auth/register or /api/auth/login
  // (depending on intent) and stores the JWT in localStorage so the rest of
  // the app — and the admin panel — can read it.
  const handleEmailSubmit = async (e) => {
    e?.preventDefault?.();
    setErrorMsg('');
    setSuccessMsg('');

    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !password) {
      setErrorMsg('Email and password are required.');
      return;
    }
    if (intent === 'signup' && password.length < 8) {
      setErrorMsg('Password must be at least 8 characters.');
      return;
    }

    setSubmitting(true);
    try {
      const r = intent === 'signup'
        ? await adminApi.register(cleanEmail, password)
        : await adminApi.login(cleanEmail, password);

      // Store the JWT under the same key the admin panel reads from.
      localStorage.setItem(VOXEL_TOKEN_KEY, r.token);

      if (intent === 'signup') {
        setSuccessMsg('Account created. You can now sign in.');
        // Brief pause so the user sees the success message, then close.
        setTimeout(() => onClose?.(), 1200);
      } else {
        // Successful login — close immediately so the parent can react.
        onClose?.();
      }
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 409) setErrorMsg('An account with that email already exists. Try signing in.');
        else if (err.status === 401) setErrorMsg('Invalid email or password.');
        else if (err.status === 429) setErrorMsg('Too many attempts. Try again in a few minutes.');
        else if (err.status === 400) setErrorMsg(err.body?.error || 'Invalid email or password.');
        else if (err.status === 503) setErrorMsg('Sign-in temporarily unavailable. Try again shortly.');
        else setErrorMsg(err.body?.error || 'Sign-in failed. Try again.');
      } else {
        setErrorMsg('Network error. Check your connection and try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const isSignup = intent === 'signup';
  const isEmail = view === 'email';

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(12px)', animation: 'lmFadeIn 0.2s ease' }}
      onClick={onClose}
    >
      <style>{`
        @keyframes lmFadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes lmSlideUp { from { opacity: 0; transform: translateY(16px) scale(0.97) } to { opacity: 1; transform: translateY(0) scale(1) } }
      `}</style>

      <div
        onClick={e => e.stopPropagation()}
        style={{ width: 'min(420px, 96vw)', background: 'rgba(14,14,14,0.98)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 20, overflow: 'hidden', boxShadow: '0 0 80px rgba(224,30,30,0.12), 0 40px 80px rgba(0,0,0,0.8)', animation: 'lmSlideUp 0.25s ease', fontFamily: font }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px 0' }}>
          <div>
            <p style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#fff' }}>
              {isSignup ? 'Create account' : 'Welcome back'}
            </p>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>
              {isSignup ? 'Join VOXEL AI today' : 'Sign in to VOXEL AI'}
            </p>
          </div>
          <button
            onClick={onClose}
            style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'rgba(255,255,255,0.5)' }}
          >
            <X size={15} />
          </button>
        </div>

        <div style={{ padding: '20px 24px 24px', display: 'flex', flexDirection: 'column', gap: 10 }}>

          {/* Email/password form */}
          {isEmail ? (
            <form onSubmit={handleEmailSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div>
                  <label style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', display: 'block', marginBottom: 6 }}>Email</label>
                  <input
                    type="email"
                    autoFocus
                    required
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '11px 14px', fontSize: 14, color: '#fff', outline: 'none', boxSizing: 'border-box', fontFamily: font }}
                    onFocus={e => e.target.style.borderColor = 'rgba(224,30,30,0.6)'}
                    onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.1)'}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', display: 'block', marginBottom: 6 }}>
                    Password{isSignup && <span style={{ color: 'rgba(255,255,255,0.3)', marginLeft: 6 }}>(min 8 chars)</span>}
                  </label>
                  <div style={{ position: 'relative' }}>
                    <input
                      type={showPass ? 'text' : 'password'}
                      required
                      minLength={isSignup ? 8 : undefined}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="••••••••"
                      style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '11px 42px 11px 14px', fontSize: 14, color: '#fff', outline: 'none', boxSizing: 'border-box', fontFamily: font }}
                      onFocus={e => e.target.style.borderColor = 'rgba(224,30,30,0.6)'}
                      onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.1)'}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPass(v => !v)}
                      style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.35)', padding: 0, display: 'flex' }}
                    >
                      {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
              </div>

              {errorMsg && (
                <div style={{ padding: '10px 12px', borderRadius: 9, background: 'rgba(224,30,30,0.1)', border: '1px solid rgba(224,30,30,0.4)', color: '#ff7777', fontSize: 12, marginTop: 4 }}>
                  {errorMsg}
                </div>
              )}
              {successMsg && (
                <div style={{ padding: '10px 12px', borderRadius: 9, background: 'rgba(60,200,120,0.1)', border: '1px solid rgba(60,200,120,0.4)', color: '#88ee88', fontSize: 12, marginTop: 4 }}>
                  {successMsg}
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                style={{ width: '100%', padding: '12px 0', borderRadius: 12, background: submitting ? 'rgba(139,0,0,0.5)' : 'linear-gradient(135deg,#CC0000,#FF2222)', border: 'none', cursor: submitting ? 'wait' : 'pointer', fontSize: 14, fontWeight: 700, color: '#fff', fontFamily: font, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 4 }}
              >
                {submitting ? 'Working…' : (isSignup ? 'Create Account' : 'Sign In')}
                {!submitting && <ArrowRight size={15} />}
              </button>

              <p style={{ margin: '6px 0 0', fontSize: 13, color: 'rgba(255,255,255,0.35)', textAlign: 'center' }}>
                {isSignup ? 'Already have an account? ' : "Don't have an account? "}
                <button
                  type="button"
                  onClick={() => { setIntent(isSignup ? 'login' : 'signup'); setErrorMsg(''); setSuccessMsg(''); }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: '#FF4444', fontFamily: font, padding: 0, fontWeight: 600 }}
                >
                  {isSignup ? 'Sign in' : 'Sign up'}
                </button>
              </p>

              <button
                type="button"
                onClick={() => { setView('options'); setErrorMsg(''); setSuccessMsg(''); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'rgba(255,255,255,0.35)', fontFamily: font, textAlign: 'center', marginTop: 2 }}
              >
                ← Back to options
              </button>
            </form>
          ) : (
            <>
              {/* Provider buttons */}
              {providers.map(({ label, icon, dark, provider }) => (
                <button
                  key={label}
                  onClick={() => handleProviderLogin(provider)}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderRadius: 12, background: dark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer', fontSize: 14, fontWeight: 500, color: '#fff', fontFamily: font, transition: 'background 0.15s, border-color 0.15s' }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.11)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = dark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.05)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; }}
                >
                  {icon}
                  <span style={{ flex: 1, textAlign: 'left' }}>{label}</span>
                </button>
              ))}

              {/* Divider */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '4px 0' }}>
                <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.08)' }} />
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)' }}>or</span>
                <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.08)' }} />
              </div>

              {/* Email option */}
              <button
                onClick={handleEmailLogin}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderRadius: 12, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer', fontSize: 14, fontWeight: 500, color: '#fff', fontFamily: font, transition: 'background 0.15s, border-color 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.11)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; }}
              >
                <Mail size={18} color="rgba(255,255,255,0.6)" />
                <span style={{ flex: 1, textAlign: 'left' }}>Continue with Email</span>
              </button>

              {/* Surface a friendly message if a provider was clicked but isn't wired yet. */}
              {errorMsg && (
                <div style={{ padding: '10px 12px', borderRadius: 9, background: 'rgba(255,200,50,0.08)', border: '1px solid rgba(255,200,50,0.3)', color: '#ffcc66', fontSize: 12 }}>
                  {errorMsg}
                </div>
              )}

              {/* Toggle login/signup */}
              <p style={{ margin: '6px 0 0', fontSize: 13, color: 'rgba(255,255,255,0.35)', textAlign: 'center' }}>
                {isSignup ? 'Already have an account? ' : "Don't have an account? "}
                <button
                  onClick={() => { setIntent(isSignup ? 'login' : 'signup'); setErrorMsg(''); }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: '#FF4444', fontFamily: font, padding: 0, fontWeight: 600 }}
                >
                  {isSignup ? 'Sign in' : 'Sign up'}
                </button>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}