// ─── notifications-routes.test.js ────────────────────────────────────────────
// The route layer's own risks, which the engine tests cannot cover:
//
//   1. OWNERSHIP. Every customer query must be scoped to req.user.id. A missing
//      "AND user_id = $n" would let any signed-in customer read or mark another
//      person's notifications by guessing an id.
//   2. Per-recipient rendering. One shared string would greet every customer by
//      the first person's name.
//   3. A rule nothing can fire must not be switchable to "on".
//   4. Email must stay a refusal, never a silent no-op.

import { describe, it, expect, vi } from 'vitest';
import { registerNotificationsRoutes, sendNotificationEmail, NotConfiguredError, notifyUser } from './notifications-routes.js';

/** Collects the routes a module registers, so we can invoke them directly. */
function fakeApp() {
  const routes = {};
  const add = (method) => (path, ...rest) => {
    routes[`${method} ${path}`] = { handler: rest[rest.length - 1], middleware: rest.slice(0, -1) };
  };
  return { get: add('GET'), post: add('POST'), patch: add('PATCH'), delete: add('DELETE'), routes };
}

function fakeRes() {
  const r = { statusCode: 200, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}

const ADMIN_GATE = ['adminGate'];
const USER_GATE = ['verifyJwt', 'requireNotBanned'];

function setup(queryImpl) {
  const app = fakeApp();
  const pool = { query: vi.fn(queryImpl) };
  registerNotificationsRoutes(app, {
    pool, dbReady: () => true, adminGate: ADMIN_GATE, userGate: USER_GATE,
  });
  return { app, pool };
}

describe('every customer route is scoped to the signed-in user', () => {
  const routes = ['GET /api/notifications', 'POST /api/notifications/read', 'POST /api/notifications/:id/click'];

  it('registers the customer routes behind verifyJwt + requireNotBanned', () => {
    const { app } = setup(async () => ({ rows: [] }));
    for (const key of routes) {
      expect(app.routes[key], key).toBeDefined();
      expect(app.routes[key].middleware.flat()).toEqual(USER_GATE);
    }
  });

  it('never puts a customer route behind the admin gate, or vice versa', () => {
    const { app } = setup(async () => ({ rows: [] }));
    expect(app.routes['GET /api/notifications'].middleware.flat()).not.toContain('adminGate');
    expect(app.routes['GET /api/admin/notifications'].middleware.flat()).toEqual(ADMIN_GATE);
  });

  // The core ownership guarantee.
  it('reads only the caller’s own rows', async () => {
    const seen = [];
    const { app, pool } = setup(async (sql, params) => {
      seen.push({ sql, params });
      if (/notification_settings/.test(sql)) return { rows: [{ daily_marketing_cap: 2, bell_enabled: true }] };
      return { rows: [] };
    });
    await app.routes['GET /api/notifications'].handler({ user: { id: 42 } }, fakeRes());
    const select = seen.find((q) => /FROM notifications/.test(q.sql));
    expect(select.sql).toMatch(/WHERE user_id = \$1/);
    expect(select.params).toEqual([42]);
  });

  it('marks read only the caller’s own rows', async () => {
    const seen = [];
    const { app } = setup(async (sql, params) => { seen.push({ sql, params }); return { rows: [] }; });
    await app.routes['POST /api/notifications/read'].handler(
      { user: { id: 42 }, body: { ids: [1, 2, 999] } }, fakeRes());
    const upd = seen.find((q) => /UPDATE notifications/.test(q.sql));
    expect(upd.sql).toMatch(/AND user_id = \$2/);
    expect(upd.params[1]).toBe(42);
  });

  it('records a click only on the caller’s own row', async () => {
    const seen = [];
    const { app } = setup(async (sql, params) => {
      seen.push({ sql, params });
      return { rows: [{ cta_url: '/pricing' }] };
    });
    await app.routes['POST /api/notifications/:id/click'].handler(
      { user: { id: 42 }, params: { id: '7' }, body: {} }, fakeRes());
    const upd = seen.find((q) => /UPDATE notifications/.test(q.sql));
    expect(upd.sql).toMatch(/WHERE id = \$1 AND user_id = \$2/);
    expect(upd.params).toEqual([7, 42]);
  });

  it('404s rather than leaking whether another user’s notification exists', async () => {
    const { app } = setup(async () => ({ rows: [] }));
    const res = fakeRes();
    await app.routes['POST /api/notifications/:id/click'].handler(
      { user: { id: 42 }, params: { id: '7' }, body: {} }, res);
    expect(res.statusCode).toBe(404);
  });
});

describe('the bell master switch', () => {
  it('returns an empty list while the bell is off, without querying rows', async () => {
    const seen = [];
    const { app } = setup(async (sql) => {
      seen.push(sql);
      if (/notification_settings/.test(sql)) return { rows: [{ daily_marketing_cap: 2, bell_enabled: false }] };
      return { rows: [] };
    });
    const res = fakeRes();
    await app.routes['GET /api/notifications'].handler({ user: { id: 1 } }, res);
    expect(res.body).toEqual({ enabled: false, notifications: [], unread: 0 });
    expect(seen.some((s) => /FROM notifications/.test(s))).toBe(false);
  });
});

describe('automations that cannot fire cannot be switched on', () => {
  it('refuses to enable a needs_checkout rule', async () => {
    const { app } = setup(async (sql) => {
      if (/SELECT \* FROM notification_automations WHERE key/.test(sql)) {
        return { rows: [{ key: 'renewal_reminder', name: 'Renewal reminder', enabled: false, needs_checkout: true, n: 3, template: 'x' }] };
      }
      return { rows: [] };
    });
    const res = fakeRes();
    await app.routes['PATCH /api/admin/notifications/automations/:key'].handler(
      { params: { key: 'renewal_reminder' }, body: { enabled: true }, user: { email: 'a@b.c' } }, res);
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toMatch(/needs a checkout/i);
  });

  it('allows a live rule to be toggled', async () => {
    const { app } = setup(async (sql) => {
      if (/SELECT \* FROM notification_automations WHERE key/.test(sql)) {
        return { rows: [{ key: 'welcome', name: 'Welcome', enabled: false, needs_checkout: false, n: null, template: 'x' }] };
      }
      if (/UPDATE notification_automations/.test(sql)) {
        return { rows: [{ key: 'welcome', enabled: true }] };
      }
      return { rows: [] };
    });
    const res = fakeRes();
    await app.routes['PATCH /api/admin/notifications/automations/:key'].handler(
      { params: { key: 'welcome' }, body: { enabled: true }, user: { email: 'a@b.c' } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.automation.enabled).toBe(true);
  });
});

describe('sending', () => {
  function sendSetup({ recipients, sentToday = [], cap = 2 }) {
    const inserted = [];
    const { app } = setup(async (sql, params) => {
      if (/FROM users u WHERE/.test(sql) || /FROM users\s+WHERE id = ANY/.test(sql)) return { rows: recipients };
      if (/notification_settings/.test(sql)) return { rows: [{ daily_marketing_cap: cap, bell_enabled: true }] };
      if (/COUNT\(\*\)::int n FROM notifications/.test(sql)) return { rows: sentToday };
      if (/INSERT INTO notification_campaigns/.test(sql)) return { rows: [{ id: 1, title: params[1] }] };
      if (/INSERT INTO notifications/.test(sql)) { inserted.push(params); return { rows: [] }; }
      return { rows: [] };
    });
    return { app, inserted };
  }

  const RECIPIENTS = [
    { id: 1, email: 'layla@x.com', display_name: 'Layla', package: 'Basic', credits: 300 },
    { id: 2, email: 'omar@x.com', display_name: 'Omar', package: 'Pro', credits: 50 },
  ];

  // One shared string would greet every customer by the first person's name.
  it('renders the message separately for each recipient', async () => {
    const { app, inserted } = sendSetup({ recipients: RECIPIENTS });
    await app.routes['POST /api/admin/notifications/send'].handler({
      body: { type: 'announce', title: 'Hi {name}', body: 'You are on {plan} with {credits} credits',
              audience_mode: 'all' },
      user: { email: 'admin@x.com' },
    }, fakeRes());

    expect(inserted).toHaveLength(2);
    expect(inserted[0][3]).toBe('Hi Layla');
    expect(inserted[1][3]).toBe('Hi Omar');
    expect(inserted[0][4]).toBe('You are on Basic with 300 credits');
    expect(inserted[1][4]).toBe('You are on Pro with 50 credits');
  });

  it('holds back recipients who already hit the daily cap', async () => {
    const { app, inserted } = sendSetup({
      recipients: RECIPIENTS, sentToday: [{ user_id: 2, n: 2 }], cap: 2,
    });
    const res = fakeRes();
    await app.routes['POST /api/admin/notifications/send'].handler({
      body: { type: 'promo', title: 'Deal', body: 'Body', audience_mode: 'all' },
      user: { email: 'admin@x.com' },
    }, res);
    expect(res.body.delivered).toBe(1);
    expect(res.body.skipped_cap).toBe(1);
    expect(inserted.map((p) => p[1])).toEqual([1]);      // only user 1
  });

  it('refuses an absolute CTA link', async () => {
    const { app } = sendSetup({ recipients: RECIPIENTS });
    const res = fakeRes();
    await app.routes['POST /api/admin/notifications/send'].handler({
      body: { type: 'announce', title: 'T', body: 'B', cta_text: 'Go',
              cta_url: 'https://evil.com', audience_mode: 'all' },
      user: { email: 'a@b.c' },
    }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/path on this site/i);
  });

  it('refuses an empty draft and names every problem', async () => {
    const { app } = sendSetup({ recipients: RECIPIENTS });
    const res = fakeRes();
    await app.routes['POST /api/admin/notifications/send'].handler({
      body: { type: 'announce', title: '', body: '', audience_mode: 'all' }, user: { email: 'a@b.c' },
    }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.errors.join(' ')).toMatch(/title/i);
    expect(res.body.errors.join(' ')).toMatch(/message/i);
  });
});

describe('email stays on hold', () => {
  it('refuses loudly rather than silently doing nothing', async () => {
    await expect(sendNotificationEmail()).rejects.toBeInstanceOf(NotConfiguredError);
    await expect(sendNotificationEmail()).rejects.toThrow(/on hold/i);
  });

  it('carries a 503 so a caller can tell it apart from a bug', async () => {
    await sendNotificationEmail().catch((e) => expect(e.status).toBe(503));
  });
});

describe('notifyUser — the automation entry point', () => {
  it('does nothing when the rule is disabled', async () => {
    const pool = { query: vi.fn(async (sql) => {
      if (/notification_automations/.test(sql)) return { rows: [{ key: 'welcome', enabled: false, needs_checkout: false }] };
      return { rows: [] };
    }) };
    const r = await notifyUser(pool, 1, { key: 'welcome' });
    expect(r).toEqual({ sent: false, reason: 'disabled' });
  });

  it('does nothing for a rule that needs a checkout', async () => {
    const pool = { query: vi.fn(async (sql) => {
      if (/notification_automations/.test(sql)) return { rows: [{ key: 'renewed', enabled: true, needs_checkout: true }] };
      return { rows: [] };
    }) };
    expect((await notifyUser(pool, 1, { key: 'renewed' })).sent).toBe(false);
  });

  // A failed notification must never break the action that triggered it.
  it('never throws, even when the database is broken', async () => {
    const pool = { query: vi.fn(async () => { throw new Error('db down'); }) };
    const r = await notifyUser(pool, 1, { type: 'gen', title: 'Ready', body: 'x' });
    expect(r.sent).toBe(false);
    expect(r.reason).toMatch(/db down/);
  });
});
