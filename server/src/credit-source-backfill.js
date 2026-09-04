// ─── credit-backfill.js ──────────────────────────────────────────────────────
// Labelling the credit rows written before `source` existed.
//
// Every new row now says who put it there. The rows already in the ledger do
// not, and there is no way to ask them — so they have to be classified from
// what they DO carry: the action, and the reason somebody typed.
//
// ☠ THE ONE RULE THIS FILE OBEYS: A ROW IT CANNOT PLACE IS LEFT ALONE.
//
// It would be easy to make everything land somewhere — sweep the leftovers
// into 'system' and report a tidy 100%. That is the failure this project keeps
// finding: a number that looks complete because the awkward cases were
// quietly absorbed. An unclassified row stays NULL and is COUNTED and SHOWN,
// because "we do not know what this was" is a real answer and a small honest
// gap is worth more than a large confident lie about the owner's money.
//
// ── WHY 'grant' NEEDS THE REASON AND NOTHING ELSE DOES ─────────────────────
// Bulk provisioning and the panel's own credit box both write action 'grant'.
// The only thing that ever separated them is the sentence bulk writes for
// itself — "bulk provision: Basic plan" — which no human typed and no human
// can misspell. For historical rows it is the best evidence there is, and it
// is used HERE, once, under the owner's eye, rather than living on inside a
// screen where it could silently change meaning later.

/** The exact sentence bulk provisioning has always written for itself. */
export const BULK_REASON = /^bulk provision:/i;

/**
 * Actions that could only ever have been the system acting on its own.
 * None of these is reachable from a person clicking anything.
 */
const SYSTEM_ACTIONS = new Set([
  'spend', 'refund', 'expire', 'signup', 'ban', 'unban', 'password_reset',
]);

/** Actions a person chose, by hand, in the panel's credit box. */
const MANUAL_ACTIONS = new Set(['grant', 'revoke', 'set']);

/**
 * What source an old row should carry.
 *
 * @returns 'manual' | 'bulk' | 'promo' | 'gift' | 'system' | null
 *          null means UNCLASSIFIED — leave it NULL, count it, show it.
 */
export function classifyRow(row = {}) {
  const action = String(row.action ?? '').trim().toLowerCase();
  const reason = String(row.reason ?? '');

  if (action === 'promo') return 'promo';
  if (action === 'gift') return 'gift';
  if (SYSTEM_ACTIONS.has(action)) return 'system';

  if (MANUAL_ACTIONS.has(action)) {
    // Only 'grant' was ever written by both. revoke and set have always been
    // a person deciding something.
    if (action === 'grant' && BULK_REASON.test(reason)) return 'bulk';
    return 'manual';
  }

  // An action nobody recognises. Could be from a path since removed, could be
  // a typo in a migration years ago. Either way it is not ours to guess.
  return null;
}

/**
 * The preview the owner approves before anything is written.
 *
 * Counts, money, and a few real examples per group — because a number alone
 * cannot be checked, and the whole point of showing this first is that a
 * person can look at three rows and say "no, those are not manual".
 */
export function previewBackfill(rows = [], { creditValueUsd = 0.063333, samples = 4 } = {}) {
  const groups = new Map();
  for (const r of rows) {
    const source = classifyRow(r);
    const key = source ?? 'unclassified';
    if (!groups.has(key)) groups.set(key, { source: key, rows: 0, credits: 0, examples: [] });
    const g = groups.get(key);
    g.rows += 1;
    g.credits += Number(r.amount) || 0;
    if (g.examples.length < samples) {
      g.examples.push({
        email: r.email ?? null,
        action: r.action ?? null,
        amount: Number(r.amount) || 0,
        reason: (r.reason ?? '').slice(0, 120),
        created_at: r.created_at ?? null,
      });
    }
  }
  const out = [...groups.values()]
    .map((g) => ({ ...g, credits: Math.round(g.credits * 100) / 100,
                   usd: Math.round(g.credits * creditValueUsd * 100) / 100 }))
    .sort((a, b) => b.rows - a.rows);
  const unclassified = out.find((g) => g.source === 'unclassified');
  return {
    groups: out,
    total_rows: rows.length,
    would_write: rows.length - (unclassified?.rows ?? 0),
    unclassified: unclassified?.rows ?? 0,
    // Said as a sentence, so the approval is given to a claim rather than to a
    // table the reader has to interpret.
    sentence: rows.length
      ? `${rows.length.toLocaleString()} unlabelled rows — `
        + out.map((g) => `${g.rows.toLocaleString()} ${g.source}`).join(', ')
        + (unclassified ? '. The unclassified ones stay untouched.' : '.')
      : 'Nothing to classify — every row already carries a source.',
  };
}
