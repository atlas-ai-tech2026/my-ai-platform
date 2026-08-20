// ─── clarity.js ──────────────────────────────────────────────────────────────
// The Microsoft Clarity tag: where it goes, and — more importantly — where it
// must never go.
//
// ── WHY IT IS HERE AT ALL ──────────────────────────────────────────────────
// #64 asked "who reaches the site, where do they click, how long do they stay".
// The server can count arrivals exactly, and cannot see any of the rest: a
// visitor reading the pricing page for ten minutes without clicking sends the
// server nothing. Clarity answers that half — heatmaps, scroll depth, session
// replay — and building a worse version of it would take weeks.
//
// ── THE CONTROL PANEL IS NEVER RECORDED ────────────────────────────────────
// This is the part that matters. Session replay plays back what was ON SCREEN.
// The control panel shows 601 customers' email addresses, their credit
// balances, promo codes, revenue and margins. Recording it would ship all of
// that to a third party, in video form, because somebody wanted a heatmap of
// the marketing pages.
//
// So the tag is injected SERVER-SIDE and skipped entirely for the admin route.
// Not hidden by CSS, not stopped after it loads — never sent. A full page load
// of the control panel contains no Clarity at all.
//
// ── AND IT IS OFF UNLESS DELIBERATELY SWITCHED ON ──────────────────────────
// No CLARITY_PROJECT_ID, no tag. That keeps development and preview traffic out
// of the real project without anyone having to remember, and it means the tag
// can be removed everywhere by clearing one variable rather than by a deploy.

/** The admin route, as it appears after the SPA shell normalises the path. */
export const ADMIN_ROUTE = 'x7k9-control-panel-mh2024';

/**
 * Should this request get the tag?
 *
 * `route` is the already-normalised path the shell handler computes: lowercased
 * and stripped of surrounding slashes. Anything under the admin route is
 * refused, not just the exact string — a future /x7k9-control-panel-mh2024/users
 * must not quietly become recordable.
 */
export function shouldInject(route, env = process.env) {
  const id = String(env.CLARITY_PROJECT_ID || '').trim();
  if (!id) return { inject: false, reason: 'CLARITY_PROJECT_ID is not set' };
  if (!/^[a-z0-9]{6,32}$/i.test(id)) {
    return { inject: false, reason: `CLARITY_PROJECT_ID "${id}" is not a valid project id` };
  }
  const path = String(route || '').toLowerCase().replace(/^\/+|\/+$/g, '');
  if (path === ADMIN_ROUTE || path.startsWith(`${ADMIN_ROUTE}/`)) {
    return { inject: false, reason: 'the control panel is never recorded' };
  }
  return { inject: true, id };
}

/**
 * The tag itself — Microsoft's async loader, with the project id substituted.
 *
 * The id is validated above against [a-z0-9] before it reaches this string, so
 * nothing from configuration can break out of the script. Belt and braces for a
 * value that is not secret but IS interpolated into executable HTML.
 */
export function clarityTag(id) {
  return '<script>(function(c,l,a,r,i,t,y){'
    + 'c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};'
    + 't=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;'
    + 'y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);'
    + `})(window,document,"clarity","script","${id}");</script>`;
}

/**
 * Put it just before </head>, or return the page untouched.
 *
 * Untouched is the default for every reason it might not apply — unset, badly
 * configured, or an admin page. A tag that fails to inject must leave a working
 * page behind, because the analytics are worth considerably less than the site.
 */
export function injectClarity(html, route, env = process.env) {
  const v = shouldInject(route, env);
  if (!v.inject) return html;
  if (!/<\/head>/i.test(html)) return html;   // no head to inject into
  return html.replace(/<\/head>/i, `${clarityTag(v.id)}</head>`);
}

/** Hosts the CSP must allow, or the browser refuses to load any of this. */
export const CLARITY_SCRIPT_HOSTS = ['https://www.clarity.ms'];
export const CLARITY_CONNECT_HOSTS = ['https://www.clarity.ms', 'https://*.clarity.ms'];
