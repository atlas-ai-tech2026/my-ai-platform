// ─── SpeechLab.jsx ───────────────────────────────────────────────────────────
// The dev-host URL for the speech lab. The SCREEN itself now lives in the
// control panel (Amr, 2026-08-30: "add this speech lab under control panel on
// production and dev"), because production's boxes, production's CDN and a
// workshop's wifi are the conditions the answer actually depends on.
//
// This page is kept as a thin wrapper so the /speech-lab link already in his
// browser keeps working, and so the measurement can be run on dev without an
// admin sign-in. ONE component underneath, so the two can never drift into
// measuring different things.

import React from 'react';
import { devOnlyVisible } from '@/lib/dev-only';
import { CrmThemeProvider } from '@/components/admin/crmTheme';
import SpeechLabTab from '@/components/admin/SpeechLabTab';

export default function SpeechLab() {
  // Never on production. There it is the control-panel tab, behind the admin
  // login, which is a stronger gate than a hostname.
  if (!devOnlyVisible()) return null;

  return (
    <CrmThemeProvider>
      <div style={{ minHeight: '100vh', background: 'var(--crm-page)', padding: '40px 24px' }}>
        <div style={{ maxWidth: 820, margin: '0 auto' }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6, color: 'var(--crm-ink)' }}>
            Speech lab
          </h1>
          <p style={{ color: 'var(--crm-w55)', fontSize: 14, lineHeight: 1.6, marginBottom: 8 }}>
            Also in the control panel, under <strong>Speech lab</strong>.
          </p>
          <SpeechLabTab />
        </div>
      </div>
    </CrmThemeProvider>
  );
}
