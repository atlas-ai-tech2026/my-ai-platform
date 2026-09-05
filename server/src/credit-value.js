// ─── credit-value.js ─────────────────────────────────────────────────────────
// What one credit is worth, in dollars. ONE place.
//
// ☠ WHY THIS FILE EXISTS. Amr filtered Manual Credits to "spa 4" and the Value
// tile read $9,605.78. The Batches screen, on the same 151,671 credits, reads
// $9,605.83. Both are money he invoices from, and they disagreed.
//
// The cause was four different answers to one question:
//   · the database stores          0.06333333   (pricing_settings.credit_value)
//   · most endpoints fall back to  0.063333
//   · pnl-routes falls back to     0.06333333
//   · ManualCreditsTab.jsx had     const CREDIT_USD = 0.063333   ← never asked
//                                                                   the database
//
// Five cents on $9,605 is nothing. THE REASON IT MATTERS IS THE DAY THE PRICE
// CHANGES: Amr has said he wants to revisit pricing. On that day the screens
// reading the database would show the new number and the hardcoded ones would
// silently keep showing the old, with nothing on the page saying so — while he
// builds invoices from both.
//
// So: the database is the answer. This module is the only place allowed to
// have an opinion about what to do when it cannot be read.

/**
 * The fallback, used ONLY when pricing_settings cannot be read.
 *
 * It matches `db.js`'s own column default (NUMERIC(12,8) DEFAULT 0.06333333)
 * on purpose — a fallback that disagrees with the schema default is just a
 * second wrong answer waiting to be displayed.
 */
export const CREDIT_VALUE_FALLBACK = 0.06333333;

/**
 * Read the live credit value. Never throws — a money screen that 500s because
 * a settings row is missing is worse than one showing the documented default.
 *
 * @param {{ query: Function }} pool
 * @returns {Promise<number>} dollars per credit
 */
export async function readCreditValue(pool) {
  try {
    const { rows } = await pool.query('SELECT credit_value FROM pricing_settings WHERE id = 1');
    const v = Number(rows?.[0]?.credit_value);
    // Number(null) is 0 and Number('') is 0 — either would silently price every
    // workshop at nothing. Only a positive, finite number is an answer.
    return Number.isFinite(v) && v > 0 ? v : CREDIT_VALUE_FALLBACK;
  } catch {
    return CREDIT_VALUE_FALLBACK;
  }
}
