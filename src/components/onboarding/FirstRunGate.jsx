// ─── FirstRunGate.jsx ────────────────────────────────────────────────────────
// Decides whether a signed-in customer sees the first-run questions.
//
// ── WHY THE SERVER DECIDES, NOT THIS COMPONENT ─────────────────────────────
// The answer depends on a COLUMN — `onboarded_at` on users — because there are
// four signup paths and a column that defaults to NULL covers every one of
// them. Deciding here from localStorage would show the flow twice to somebody
// who signs up on a phone and opens a laptop, and again to anybody who clears
// their cookies.
//
// ── AND WHY IT FAILS TOWARDS NOT SHOWING ───────────────────────────────────
// If the check errors, the customer goes straight into the product. A survey
// that cannot decide must not stand in the doorway of the thing they paid for.

import React, { useEffect, useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { base44 } from '@/api/base44Client';
import FirstRun from './FirstRun';

/**
 * The one place the routes are named, so a rename cannot half-land.
 *
 * ── ALL THREE GO THROUGH `invoke`, WHICH ALWAYS POSTS ────────────────────
 * That is not a style choice. On 2026-08-30 /api/history/models was
 * registered as a GET, invoke posted to it, the call 404'd, the client
 * swallowed it into an empty list and the model dropdown rendered disabled —
 * looking like a customer with no history rather than a broken route. Amr
 * found it by opening the dropdown.
 *
 * So the check is a POST too, and the server registers it with app.all.
 * src/lib/invoke-reachable.test.js reads both halves and fails if they part.
 */
const API = {
  check: () => base44.functions.invoke('onboarding', {}),
  step: (body) => base44.functions.invoke('onboarding/step', body),
  done: (body) => base44.functions.invoke('onboarding/done', body),
};

export default function FirstRunGate() {
  const { isAuthenticated, isLoadingAuth, user } = useAuth();
  const [show, setShow] = useState(false);

  useEffect(() => {
    let alive = true;
    if (isLoadingAuth || !isAuthenticated) { setShow(false); return undefined; }
    API.check()
      .then((r) => { if (alive) setShow(Boolean(r?.data?.show)); })
      .catch(() => { if (alive) setShow(false); });   // fail towards the product
    return () => { alive = false; };
  }, [isAuthenticated, isLoadingAuth]);

  if (!show) return null;

  return (
    <FirstRun
      userId={user?.id}
      api={API}
      onFinish={() => setShow(false)}
    />
  );
}
