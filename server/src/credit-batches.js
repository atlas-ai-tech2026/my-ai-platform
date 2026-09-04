// ─── credit-batches.js ───────────────────────────────────────────────────────
// One row per THING YOU DID, not per person.
//
// Owner, 2026-09-04: "After the workshop I go manually to the promo codes and
// take the name, the number of credits, the promo code, the number of accounts
// that used it, then put it manually on the invoice… I need one screen: the
// name, which type, the date, the total accounts, the total credits."
//
// He is describing an invoice line. The ledger holds one row per PERSON, so
// answering that by hand means reading 71 rows and adding them up. This groups.
//
// ── THE GROUPING KEY IS THE PART THAT MATTERS ──────────────────────────────
// A batch is (what it was for) x (how it was done) x (the day). The name comes
// from the reason somebody typed — and his own SPA 4 credits were typed THREE
// ways: "spa 4", "Spa 4", and "Spa 4." with a full stop. Grouped exactly, one
// workshop becomes three invoice lines.
//
// So names are matched loosely — case, spacing and trailing punctuation are
// ignored — and every batch reports how many spellings it absorbed, so the
// untidiness stays visible rather than being hidden. The name SHOWN is the
// commonest spelling, never an invented tidy one.

/** How a row was created, in words that mean something on an invoice. */
export function batchType(row = {}) {
  const source = String(row.source ?? '').toLowerCase();
  const reason = String(row.reason ?? '');
  if (source === 'promo') {
    return /top-up/i.test(reason) ? 'Promo top-up' : 'Promo code';
  }
  if (source === 'bulk') {
    if (/^bulk top-up:/i.test(reason)) return 'Bulk top-up';
    if (/^bulk provision:/i.test(reason)) return 'Bulk - new accounts';
    return 'Bulk';
  }
  if (source === 'gift') return 'Gift card';
  if (source === 'manual') return 'Manual grant';
  return 'Other';
}

/** The promo code inside a reason, when there is one. */
export function codeIn(reason = '') {
  const m = /\b(VOXEL-[A-Z0-9]+(?:-[A-Z0-9]+)*)\b/.exec(String(reason).toUpperCase());
  return m ? m[1] : null;
}

/**
 * The human name of a batch — the reason with its machinery removed.
 *
 *   "bulk top-up: SPA News Academy V1.2"          -> "SPA News Academy V1.2"
 *   "bulk provision: Basic plan - SPA News V1.2"  -> "SPA News V1.2"
 *   "promo: VOXEL-VPW9-DY93"                      -> "VOXEL-VPW9-DY93"
 */
export function batchName(reason = '') {
  let s = String(reason).trim();
  s = s.replace(/^bulk top-up:\s*/i, '');
  s = s.replace(/^bulk provision:\s*[^—-]*(?:—|--|-)\s*/i, '');
  s = s.replace(/^bulk provision:\s*/i, '');
  s = s.replace(/^promo top-up:\s*/i, '');
  s = s.replace(/^promo:\s*/i, '');
  s = s.replace(/^gift card:\s*/i, '');
  return s.trim() || '(no reason given)';
}

/**
 * Workshops whose entries were named freely before there was a field for it.
 *
 * ☠ A CUSTOMER'S NAME IN THE CODE IS A SMELL, AND IT IS THE HONEST FIX TODAY.
 * The owner, 2026-09-04: "Anything starting with SPA alone, and there is SPA
 * two, and there is SPA four. Anything else is very small and was testing."
 * His hand-typed grants carry "spa", "spa 2", "spa 3 promo code", "SPA4",
 * "Spa 4.", and one that reads "Spa 4 its was his credit and we removed and
 * then we returned agian" — all of them the same three or four workshops,
 * split across nine invoice lines.
 *
 * Everything written from now on carries a proper reason field, so this
 * pattern covers a closed set of history and does not grow. The permanent fix
 * is the workshop record, which already exists in `workshops`.
 *
 * The trailing boundary matters: without it `spain` in "director from spain"
 * matches, and a person's note becomes a workshop.
 */
// ☠ THE NUMBER IS WHAT MAKES IT A MATCH, and the first version got it wrong.
// `/^spa\s*(\d+)?\b/` also matched "SPA News Academy V1.2" — the owner's
// CURRENT workshop — and folded it into the old "spa" grants. An existing test
// caught it. So: "spa" must be followed by a NUMBER, or by nothing at all.
//   spa            -> spa          (alone, the owner's first workshop)
//   spa 3 promo code -> spa 3      (a number, then anything)
//   SPA4           -> spa 4        (spacing normalised before this runs)
//   SPA News 4     -> unchanged    (a word follows, not a number)
//   spain          -> unchanged    (no boundary after "spa")
const WORKSHOP_PREFIX = /^(spa)(?:\s*(\d+)\b|\b(?=[\s.,;:!?]*$))/i;

/** The key two spellings of one workshop must share. */
export function nameKey(name = '') {
  const base = String(name)
    .toLowerCase()
    // "SPA4" and "spa 4" are the same workshop typed two ways.
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/[.,;:!?]+$/g, '')      // "Spa 4." and "Spa 4" are one workshop
    .replace(/\s+/g, ' ')
    .trim();
  // A reason that STARTS with a workshop belongs to it, whatever follows —
  // "spa 3 promo code" and "Spa 4 its was his credit…" are that workshop's
  // money, not two more workshops.
  const m = WORKSHOP_PREFIX.exec(base);
  return m ? `${m[1]}${m[2] ? ' ' + m[2] : ''}` : base;
}

// ☠ node-postgres hands back Date OBJECTS for timestamp columns, not ISO
// strings. The first version of this was `String(v).slice(0, 10)`, which on a
// real row produces "Thu Aug 20" — and every date on the screen read
// "Invalid Date". The unit tests passed because they fed ISO strings, which is
// the shape I invented, not the shape the database sends. Accept both.
const day = (v) => {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
};

/** A timestamp as a number, for comparing. NaN-free so sorting is stable. */
const ms = (v) => {
  if (!v) return 0;
  const d = v instanceof Date ? v : new Date(v);
  const t = d.getTime();
  return Number.isNaN(t) ? 0 : t;
};

/**
 * Group ledger rows into batches.
 *
 * ☠ ONLY ADDITIONS. This screen answers "what did we hand out", which is what
 * an invoice bills for. A revoke is real money too, but it is not a line on an
 * invoice — and mixing the two makes a total that means neither thing.
 */
export function groupBatches(rows = [], { creditValueUsd = 0.063333, describe = {} } = {}) {
  // ☠ THE NAME OF A PROMO BATCH IS THE CODE'S DESCRIPTION, NOT THE CODE.
  // Owner, 2026-09-05: "There is one column called promo code and you write it
  // there. It is not necessary to write it two times. The name will be the
  // description of the promo code, and keep the promo code as is."
  // He is right — the reason on a promo ledger row is "promo: VOXEL-VPW9-DY93",
  // so the Name column repeated the Promo code column on every promo row.
  // "SPA News Academy 5th 4th" is the thing you would look for on an invoice.
  //
  // Only the LABEL changes. The grouping key still contains the code, because
  // two different codes can share one description — "Ali Bin Awad Demo" is
  // TWO codes on production — and merging them would put one code beside
  // another code's money.
  const described = new Map(
    Object.entries(describe || {}).map(([code, d]) => [String(code).toUpperCase(), d]),
  );
  const map = new Map();
  for (const r of rows) {
    const amount = Number(r.amount) || 0;
    if (amount <= 0) continue;
    const type = batchType(r);
    const name = batchName(r.reason);
    // ☠ NOT KEYED BY DAY. A workshop is one thing even when the credits were
    // handed out across several afternoons — the owner's own SPA 4 ran on
    // 20 AND 27 August, and keying by day split one customer into two invoice
    // lines with two partial totals. The dates are shown as a RANGE instead,
    // so nothing about when it happened is lost.
    const key = `${type}|${nameKey(name)}`;
    if (!map.has(key)) {
      map.set(key, {
        key, type, name, code: codeIn(r.reason), date: day(r.created_at),
        accounts: new Set(), credits: 0, entries: 0, days: new Set(),
        spellings: new Map(), first: r.created_at, last: r.created_at,
      });
    }
    const b = map.get(key);
    b.entries += 1;
    b.credits += amount;
    if (r.user_id != null) b.accounts.add(r.user_id);
    b.spellings.set(name, (b.spellings.get(name) || 0) + 1);
    if (r.created_at) b.days.add(day(r.created_at));
    // ☠ Compared as NUMBERS. Comparing the raw values put "Fri" before
    // "Thu" and ordered the whole table by the name of the weekday.
    if (r.created_at && ms(r.created_at) < ms(b.first)) b.first = r.created_at;
    if (r.created_at && ms(r.created_at) > ms(b.last)) b.last = r.created_at;
    if (!b.code) b.code = codeIn(r.reason);
  }

  return [...map.values()].map((b) => {
    // Show the commonest spelling, never an invented tidy one.
    const [best] = [...b.spellings.entries()].sort((a, c) => c[1] - a[1]);
    const spelt = best ? best[0] : b.name;
    // A code with no description falls back to the code — a blank Name column
    // would be worse than the repetition it replaces.
    const described_name = b.code ? described.get(String(b.code).toUpperCase()) : null;
    const name = String(described_name || '').trim() || spelt;
    return {
      key: b.key, type: b.type, name, code: b.code,
      date: day(b.first), date_to: day(b.last),
      // Sent as ISO strings so the browser formats them in the owner's own
      // timezone — the same way Manual Credits does, so the two screens agree.
      first: new Date(ms(b.first)).toISOString(), last: new Date(ms(b.last)).toISOString(),
      // How many separate days this batch was handed out over. 1 is the quiet
      // case; more than one is worth seeing on an invoice.
      days: b.days.size,
      accounts: b.accounts.size, entries: b.entries,
      credits: Math.round(b.credits * 100) / 100,
      usd: Math.round(b.credits * creditValueUsd * 100) / 100,
      // How many different spellings this batch absorbed. 1 is the quiet case.
      spellings: b.spellings.size,
      spelt: [...b.spellings.keys()],
    };
  }).sort((a, b) => ms(b.last) - ms(a.last));
}

/** Totals for whatever is on screen — the figure that goes on the invoice. */
export function totalBatches(batches = [], { creditValueUsd = 0.063333 } = {}) {
  const credits = batches.reduce((t, b) => t + b.credits, 0);
  return {
    batches: batches.length,
    accounts: batches.reduce((t, b) => t + b.accounts, 0),
    credits: Math.round(credits * 100) / 100,
    usd: Math.round(credits * creditValueUsd * 100) / 100,
  };
}

/**
 * Promo codes that exist but have never been redeemed.
 *
 * ☠ THEIR ABSENCE WAS CORRECT AND INVISIBLE, WHICH MADE IT A BUG.
 * Owner, 2026-09-05: "The total number of promo codes on production is 27. I
 * don't know why it's less than this. Maybe because you only add the activated
 * one?"
 *
 * No — active is never consulted. Batches reads the credits ledger, which a
 * code only writes to when somebody redeems it, so a code nobody used has no
 * line. That is right: there is nothing to invoice. But he counted 27, counted
 * the rows, and had no way to find out where the difference went — the same
 * shape as the totals that covered the page instead of the filter.
 *
 * So the gap is named instead of being silently correct. Empty rows are NOT
 * the answer: "0 accounts · $0.00" on an invoice screen is noise, and it is
 * something that could be invoiced by mistake.
 *
 * @param promos  every row of promo_codes: { code, description, active }
 * @param reasons every DISTINCT reason on a promo ledger row, unfiltered —
 *                unfiltered on purpose, so narrowing the dates cannot make a
 *                used code look like it was never used.
 */
export function unredeemedCodes(promos = [], reasons = []) {
  const used = new Set();
  for (const r of reasons) {
    const c = codeIn(typeof r === 'string' ? r : r?.reason);
    if (c) used.add(c);
  }
  return (promos || [])
    .filter((p) => p?.code && !used.has(String(p.code).toUpperCase()))
    .map((p) => ({
      code: p.code,
      description: String(p.description || '').trim() || null,
      active: p.active !== false,
    }));
}
