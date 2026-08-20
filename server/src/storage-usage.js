// ─── storage-usage.js ────────────────────────────────────────────────────────
// How much storage are we using, how fast is it growing, and WHEN will it cost
// money — asked daily, answered before the limit rather than after it.
//
// ── WHY IT EXISTS ──────────────────────────────────────────────────────────
// The owner asked for it in the plainest possible terms on 2026-08-19:
// "tell me I will start or become to exceed the limit to start, make a
// subscription for them." Not "you are over" — "you are ABOUT to be over."
//
// That distinction is the whole feature. A quota you discover by exceeding it
// is an outage: the media sync stops, new files stop being copied, and the
// first symptom is a customer noticing their history is broken weeks later.
// A quota you discover 40 days out is a calendar entry.
//
// ── WHAT IT WATCHES ────────────────────────────────────────────────────────
//   DigitalOcean Spaces — $5/mo includes 250 GiB. Currently ~66 GiB.
//   Backblaze B2       — first 10 GB free, then billed. The DATABASE backups
//                        live under 10 GB today; adding customer media pushes
//                        it well past, so this is the account that will need a
//                        payment method first.
//
// ── THE PROJECTION IS THE POINT, AND IT MUST BE HONEST ─────────────────────
// A percentage is not actionable. "83% full" could be six days away or six
// months. So this records size daily and reports a RATE and a DATE.
//
// And it refuses to project from too little history. One measurement is a
// number, not a trend; two taken hours apart extrapolate to nonsense. Below
// MIN_POINTS it says "still learning" — which is honest, and unlike a
// confident wrong date, cannot be acted on by mistake.

export const GIB = 1024 ** 3;
export const GB = 1000 ** 3;   // Backblaze bills in decimal GB, DO quotes GiB

/**
 * What each provider gives us before charging more.
 *
 * Read from the providers' own pricing pages on 2026-08-19 rather than from
 * memory — the whole reason this file can be trusted is that its numbers were
 * looked up, and they should be looked up again when they are questioned.
 */
export const ALLOWANCES = {
  spaces: {
    label: 'DigitalOcean Spaces',
    limitBytes: 250 * GIB,
    limitLabel: '250 GiB',
    unit: 'objects',
    included: 'included in the $5/month plan',
    overage: '$0.02 per extra GiB',
    overageUsdPerUnit: 0.02, overageUnitBytes: GIB,
    action: 'Nothing to do until it is close. Above the limit DigitalOcean bills automatically — no interruption, just a larger invoice.',
    overAction: 'Over the included 250 GiB. Nothing breaks — DigitalOcean simply bills the excess.',
  },
  database: {
    label: 'Postgres',
    // db-s-1vcpu-1gb — the smallest managed plan, 10 GB of disk. Confirmed from
    // `doctl databases list` rather than assumed.
    limitBytes: 10 * GIB,
    limitLabel: '10 GiB',
    unit: 'rows (estimated by the planner, not counted)',
    included: 'the db-s-1vcpu-1gb plan',
    overage: 'a larger plan — DigitalOcean does not bill overage, the disk simply fills',
    // The one that does not degrade gracefully. Storage over its allowance
    // costs money; a database disk that fills stops accepting writes, which
    // means generations fail and nobody can sign in.
    action: 'Resize the database BEFORE it fills. A full Postgres disk does not bill you extra — '
      + 'it stops accepting writes, and the platform stops working.',
    overAction: 'THE DISK IS FULL. Postgres will be refusing writes: generations fail and nobody '
      + 'can sign in. Resize the database now — this does not resolve itself and no invoice warns you.',
  },
  offsite: {
    label: 'Backblaze B2',
    limitBytes: 10 * GB,
    limitLabel: '10 GB free',
    unit: 'objects',
    included: 'the always-free allowance',
    overage: '$6.95 per TB per month',
    overageUsdPerUnit: 6.95, overageUnitBytes: 1000 ** 4,
    // ── 10 GB IS A FREE TIER, NOT A CEILING ────────────────────────────────
    // The owner put a card on the account on 2026-08-20, so being above it is
    // a billed, expected state — like any other paid service. Judging it as a
    // quota would have pinned this line at 714% CRITICAL permanently, and a
    // light that is always red is one nobody looks at. That failure has cost
    // this project real time twice already this week.
    //
    // So above the free tier the state follows the MONEY, which is the thing
    // that can actually get out of hand. $5/month is roughly 720 GB — ten
    // times today's size and far more than customer media can plausibly reach
    // without something being wrong.
    billedAboveFreeTier: true,
    costWarnUsd: 5,
    costCriticalUsd: 20,
    action: 'Add a payment method to Backblaze BEFORE this is crossed. Above the free allowance without one, uploads fail and the offsite copy silently stops.',
    overAction: 'The free allowance is ALREADY passed — this is no longer something to do before it '
      + 'happens. Confirm a payment method is on file at Backblaze. Without one, uploads start '
      + 'failing and the offsite copy stops with no error anyone sees.',
  },
};

/** Warn at four fifths, shout at 95%. */
export const WARN_AT = 0.80;
export const CRITICAL_AT = 0.95;

/** Where replicated customer media lives in the offsite bucket. */
export const MEDIA_PREFIX = 'media/';

/**
 * Is customer media actually backed up — asked by COUNTING it, not by trusting
 * a flag.
 *
 * The owner asked for a reminder to add a payment method to Backblaze. A
 * to-do item would have worked until somebody ticked it off, and then it would
 * have said "done" whether or not a single file had ever been copied. This
 * counts objects in the offsite bucket instead, so it goes quiet exactly when
 * the thing is TRUE and not one moment before.
 *
 * It also states the real position plainly every single day until then: 66 GiB
 * of customer work exists in one place. That has been true for weeks and the
 * SOP has never once said so.
 */
export function judgeMediaBackup({ source, offsite }) {
  const sourceFiles = source?.objects ?? null;
  if (offsite?.error) {
    return {
      state: 'unknown',
      detail: `the offsite copy could not be counted: ${offsite.error}`,
      action: 'An unverified backup is not a backup — find out why this could not be read.',
    };
  }
  const copied = offsite?.objects ?? 0;
  if (copied === 0) {
    return {
      state: 'critical',
      detail: sourceFiles == null
        ? 'no customer media has been copied offsite'
        : `${sourceFiles.toLocaleString()} customer files exist in ONE place — none are copied offsite`,
      action: 'Add a payment method to Backblaze (about $0.42/month at current size), then the media sync '
        + 'can be switched on. Until then, losing the bucket loses every customer’s history permanently.',
    };
  }
  const missing = sourceFiles == null ? null : sourceFiles - copied;
  if (missing != null && missing > 0) {
    return {
      state: 'warn',
      detail: `${copied.toLocaleString()} of ${sourceFiles.toLocaleString()} files copied offsite — ${missing.toLocaleString()} not yet protected`,
      action: 'The sync is behind. Check the last run before assuming it is simply catching up.',
    };
  }
  return {
    state: 'ok',
    detail: `${copied.toLocaleString()} files copied offsite${sourceFiles != null ? ` of ${sourceFiles.toLocaleString()}` : ''}`,
    action: null,
  };
}

/** Fewer than this many measurements and any growth rate is invented. */
export const MIN_POINTS = 3;

/** Below this many days apart, two points cannot describe a daily rate. */
export const MIN_SPAN_DAYS = 1;

export async function ensureUsageTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS storage_usage (
      id          SERIAL PRIMARY KEY,
      provider    VARCHAR(32)  NOT NULL,   -- 'spaces' | 'offsite'
      bucket      VARCHAR(128) NOT NULL,
      bytes       BIGINT       NOT NULL,
      objects     INTEGER      NOT NULL,
      measured_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )`);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS storage_usage_idx ON storage_usage (provider, measured_at DESC)`);
}

/**
 * Total size of a bucket, PAGINATED.
 *
 * `listKeys` in storage.js caps at MaxKeys 1000 and does not follow the
 * continuation token — correct for listing a handful of backups, and silently
 * wrong for a bucket of 11,320 objects. Measuring 8% of a bucket and calling it
 * the size is exactly the kind of confidently-wrong number this whole file is
 * meant to prevent.
 */
export async function measureBucket(client, bucket, { ListObjectsV2Command, maxPages = 200, prefix } = {}) {
  let bytes = 0;
  let objects = 0;
  let token;
  let pages = 0;
  do {
    const out = await client.send(new ListObjectsV2Command({
      Bucket: bucket, MaxKeys: 1000, ContinuationToken: token,
      ...(prefix ? { Prefix: prefix } : null),
    }));
    for (const o of out.Contents || []) { bytes += Number(o.Size) || 0; objects += 1; }
    token = out.IsTruncated ? out.NextContinuationToken : undefined;
    pages += 1;
    // A bucket larger than 200,000 objects would loop for a long time on a
    // check that runs daily. Truncation is REPORTED, never silently accepted —
    // a capped count presented as a total is a lie with a plausible face.
    if (pages >= maxPages && token) {
      return { bytes, objects, truncated: true };
    }
  } while (token);
  return { bytes, objects, truncated: false };
}

/**
 * Every object in a bucket, paginated — key and size only.
 *
 * Separate from measureBucket because the sync needs the LIST, not the total,
 * and building the list twice from two different paginators is how the two
 * quietly disagree about what is in the bucket.
 */
export async function listAllObjects(client, bucket, { ListObjectsV2Command, prefix, maxPages = 200 } = {}) {
  const objects = [];
  let token;
  let pages = 0;
  do {
    const out = await client.send(new ListObjectsV2Command({
      Bucket: bucket, MaxKeys: 1000, ContinuationToken: token,
      ...(prefix ? { Prefix: prefix } : null),
    }));
    for (const o of out.Contents || []) objects.push({ key: o.Key, size: Number(o.Size) || 0 });
    token = out.IsTruncated ? out.NextContinuationToken : undefined;
    pages += 1;
    // Truncation is REPORTED. A partial list handed to the sync would look
    // exactly like "everything is already copied".
    if (pages >= maxPages && token) return { objects, truncated: true };
  } while (token);
  return { objects, truncated: false };
}

export async function recordUsage(pool, { provider, bucket, bytes, objects }) {
  await ensureUsageTable(pool);
  await pool.query(
    `INSERT INTO storage_usage (provider, bucket, bytes, objects) VALUES ($1,$2,$3,$4)`,
    [provider, bucket, Math.round(bytes), Math.round(objects)]);
}

export async function usageHistory(pool, provider, days = 60) {
  await ensureUsageTable(pool);
  const { rows } = await pool.query(
    `SELECT bytes, objects, measured_at FROM storage_usage
      WHERE provider = $1 AND measured_at > NOW() - ($2 || ' days')::INTERVAL
      ORDER BY measured_at ASC`, [provider, days]);
  return rows.map((r) => ({ bytes: Number(r.bytes), objects: r.objects, at: new Date(r.measured_at) }));
}

/**
 * Growth per day, from the oldest and newest measurements.
 *
 * Deliberately the simplest possible model, and deliberately refuses to run on
 * thin data. A fitted curve over five noisy points would look more rigorous and
 * be no more true.
 */
/**
 * One reading per calendar day — the LAST of each day.
 *
 * recordUsage writes a row every time the SOP screen is opened, so "readings"
 * and "days" are not the same thing and MIN_POINTS was counting the wrong one.
 * Opening the screen three times in an afternoon satisfied "3 daily readings"
 * and produced a confident crossing date from a few hours of noise — precisely
 * what the header of this file says it refuses to do.
 *
 * Days are taken in UTC. Kuwait is UTC+3, so a reading taken late in the
 * evening lands on the next UTC day; that shifts which sample represents a day
 * but never merges two days or splits one, and the rate is over days either way.
 */
export function dailyPoints(history = []) {
  const byDay = new Map();
  for (const p of history) {
    const sampledAt = p.at instanceof Date ? p.at : new Date(p.at);
    if (Number.isNaN(sampledAt.getTime())) continue;
    const day = sampledAt.toISOString().slice(0, 10);
    // The size is the last reading of the day; the TIME is the day itself.
    //
    // Keeping the sample's clock time would leave the denominator dependent on
    // what hour the screen happened to be opened: the same three days of growth
    // read as 80 MiB/day or 100 MiB/day depending on whether the first day was
    // sampled at 07:00 or 22:00. Over a month that is noise. Over three days it
    // is a fifth of the answer, and three days is exactly when this first
    // speaks. A per-day rate should be measured in days.
    byDay.set(day, { ...p, at: new Date(`${day}T00:00:00.000Z`), sampledAt });
  }
  return [...byDay.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, p]) => p);
}

export function growthPerDay(history = []) {
  const points = dailyPoints(history);
  if (points.length < MIN_POINTS) return null;
  const first = points[0];
  const last = points[points.length - 1];
  const days = (last.at - first.at) / 864e5;
  if (!Number.isFinite(days) || days < MIN_SPAN_DAYS) return null;
  return (last.bytes - first.bytes) / days;
}

/**
 * When do we cross the allowance?
 *
 * Returns null when it cannot be known — no history, or storage flat or
 * shrinking. "Never at this rate" is a real and good answer, and must not be
 * dressed up as a date.
 */
export function projectCrossing(currentBytes, perDay, limitBytes) {
  if (perDay == null || perDay <= 0) return null;
  if (currentBytes >= limitBytes) return { daysLeft: 0, already: true };
  return { daysLeft: Math.floor((limitBytes - currentBytes) / perDay), already: false };
}

export const fmt = (bytes, base = GIB) => `${(bytes / base).toFixed(1)} ${base === GIB ? 'GiB' : 'GB'}`;

/**
 * Same bytes, but in a unit a human would have chosen.
 *
 * fmt() is fixed to the allowance's unit, which is right for "0.4 GiB of
 * 10 GiB" and useless anywhere the magnitude is not known in advance. A
 * database growing 40 MiB a day renders as "growing 0.0 GiB/day" — sitting
 * directly beside "crosses the allowance in about 240 days", which reads as a
 * screen contradicting itself, and a screen that contradicts itself stops being
 * read. Same for a table list where four of five rows say "0.0 GiB".
 */
export function fmtScaled(bytes, base = GIB) {
  // Backblaze bills in decimal GB and DigitalOcean quotes binary GiB. Scaling
  // a decimal allowance with binary units would print "9.5 GiB of 10 GB free"
  // for a bucket that is ALREADY OVER — under-reporting exactly the number the
  // owner asked to be warned about. So the unit follows the allowance.
  const binary = base === GIB;
  const [k, u] = binary ? [1024, ['B', 'KiB', 'MiB', 'GiB']] : [1000, ['B', 'KB', 'MB', 'GB']];
  const n = Math.abs(bytes);
  if (n >= k ** 3) return `${(bytes / k ** 3).toFixed(1)} ${u[3]}`;
  if (n >= k ** 2) return `${Math.round(bytes / k ** 2)} ${u[2]}`;
  if (n >= k) return `${Math.round(bytes / k)} ${u[1]}`;
  return `${Math.round(bytes)} ${u[0]}`;
}

/**
 * What the excess costs per month, in words, or null when it is not billed.
 *
 * Rounded to cents and never below one cent, because "$0.00 per month" reads as
 * a bug rather than as "this is negligible".
 */
export function overageCost(overBytes, allowance) {
  const { overageUsdPerUnit: rate, overageUnitBytes: unit } = allowance || {};
  if (!rate || !unit || !(overBytes > 0)) return null;
  const usd = (overBytes / unit) * rate;
  return usd < 0.01 ? 'under $0.01' : `$${usd.toFixed(2)}`;
}

/**
 * Turn a measurement plus its history into something worth reading at 6am.
 *
 * Three states and a deliberate fourth: `unknown` when the bucket could not be
 * read. A quota check that cannot see the bucket must never render as healthy —
 * that is how a silent failure survives for months.
 */
export function judgeUsage({ provider, measurement, history = [], now = Date.now() }) {
  const a = ALLOWANCES[provider];
  if (!a) return { provider, state: 'unknown', detail: `no allowance is defined for "${provider}"` };
  if (!measurement || measurement.error) {
    return {
      provider, label: a.label, state: 'unknown',
      detail: `could not be measured: ${measurement?.error || 'no reading'}`,
      action: 'An unmeasured quota is not a safe one — find out why this could not be read.',
    };
  }

  const base = provider === 'offsite' ? GB : GIB;
  const used = measurement.bytes;
  const pct = used / a.limitBytes;
  const perDay = growthPerDay(history);
  const crossing = projectCrossing(used, perDay, a.limitBytes);

  // ONE rounding. The heading is built from `pct` below and the detail was
  // rounded separately, so the same measurement appeared as "26.6% of 250
  // GiB" and "(27%)" on a single line — small, and exactly the kind of
  // thing that makes someone stop trusting the rest of the number.
  const pct1 = Math.round(pct * 1000) / 10;
  const parts = [`${fmtScaled(used, base)} of ${a.limitLabel} (${pct1}%)`,
    // "18,256 objects" is right for a bucket and wrong for a database, where
    // they are rows — and an ESTIMATED count of them at that.
    `${measurement.objects.toLocaleString()} ${a.unit || 'objects'}`];
  if (measurement.truncated) parts.push('COUNT TRUNCATED — the real total is higher');

  // ── ALREADY OVER IS SAID FIRST, AND WITHOUT NEEDING A RATE ───────────────
  // This used to live inside the growth branch, so it printed only when a daily
  // rate was known. On production Backblaze read "71.4 GB of 10 GB free (714%)
  // · growing at an unknown rate" — 714% on the screen and not one word saying
  // the limit was passed. Being over is a fact about right now; it does not
  // depend on knowing how fast you got there.
  const over = used - a.limitBytes;
  if (over > 0) {
    parts.push(a.billedAboveFreeTier
      ? `${fmtScaled(over, base)} above the free tier, which is billed`
      : `ALREADY OVER the allowance by ${fmtScaled(over, base)}`);
    const cost = overageCost(over, a);
    // The percentage alone reads like a catastrophe. 714% of a free tier that
    // starts at 10 GB is about fifty cents a month, and knowing that is the
    // difference between a decision and a panic.
    if (cost) parts.push(`about ${cost} per month at this size`);
  }

  if (perDay == null) {
    parts.push(`growing at an unknown rate — ${dailyPoints(history).length} of ${MIN_POINTS} `
      + 'daily readings so far');
  } else if (perDay <= 0) {
    parts.push('not growing');
  } else {
    parts.push(`growing ${fmtScaled(perDay, base)}/day`);
    if (over <= 0 && crossing) parts.push(`crosses the allowance in about ${crossing.daysLeft} days`);
  }

  // Above a FREE TIER that is billed, the percentage stops being the thing
  // worth judging — 714% of a free 10 GB is forty-three cents. What matters is
  // the bill, so that is what sets the state.
  const monthlyUsd = a.billedAboveFreeTier && over > 0
    ? (over / a.overageUnitBytes) * a.overageUsdPerUnit
    : null;

  // A truncated count means we do not know the size, so it cannot be a pass.
  let state = 'ok';
  if (measurement.truncated) state = 'unknown';
  else if (monthlyUsd != null) {
    state = monthlyUsd >= (a.costCriticalUsd ?? Infinity) ? 'critical'
      : monthlyUsd >= (a.costWarnUsd ?? Infinity) ? 'warn' : 'ok';
  } else if (pct >= CRITICAL_AT) state = 'critical';
  else if (pct >= WARN_AT) state = 'warn';
  // The projection escalates on its own: comfortably inside the limit today but
  // arriving within a month is exactly the moment worth a warning, and is the
  // thing the owner actually asked for.
  else if (crossing && !crossing.already && crossing.daysLeft <= 30) state = 'warn';

  return {
    provider, label: a.label, state,
    bytes: used, objects: measurement.objects,
    pct: pct1,
    perDayBytes: perDay,
    daysLeft: crossing?.already ? 0 : (crossing?.daysLeft ?? null),
    detail: parts.join(' · '),
    action: state === 'ok' ? null : (over > 0 && a.overAction) ? a.overAction : a.action,
    monthlyUsd,
    now,
  };
}

/**
 * How big the database is, and which tables account for it.
 *
 * ── WHY THIS IS DIFFERENT FROM THE STORAGE CHECKS ──────────────────────────
 * Spaces and Backblaze over their allowance cost MONEY. A Postgres disk that
 * fills does not bill you extra — it stops accepting writes. Generations fail,
 * nobody can sign in, and the first symptom is the platform simply not working.
 *
 * So this is measured the same way and judged with the same projection, but the
 * action says "resize before it fills", not "expect a larger invoice".
 *
 * Measured from the SERVER because the database only accepts connections from
 * trusted sources — a laptop cannot reach it, which is correct, and is why this
 * number could never be answered by hand.
 */
export async function measureDatabase(pool, { topTables = 5 } = {}) {
  try {
    const { rows: [t] } = await pool.query(
      `SELECT pg_database_size(current_database())::bigint AS bytes`);
    // EVERY table, not the top few. The row total has to be the whole database
    // or it is not a row total, and summing the biggest five while labelling it
    // "rows" is the kind of number that looks right and is not.
    const { rows: all } = await pool.query(`
      SELECT c.relname AS name,
             pg_total_relation_size(c.oid)::bigint AS bytes,
             COALESCE(s.n_live_tup, 0)::bigint AS live_rows
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
       WHERE n.nspname = 'public' AND c.relkind = 'r'
       ORDER BY pg_total_relation_size(c.oid) DESC`);
    const tables = all.map((r) => ({
      name: r.name, bytes: Number(r.bytes), rows: Number(r.live_rows),
    }));
    return {
      bytes: Number(t.bytes),
      // n_live_tup is the planner's ESTIMATE, refreshed by autovacuum. Right for
      // "which tables are big", wrong to quote as an exact count — so it is only
      // ever shown next to a size, never on its own as a fact about the business.
      objects: tables.reduce((sum, r) => sum + r.rows, 0),
      truncated: false,
      bucket: 'postgres',
      tableCount: tables.length,
      tables: tables.slice(0, topTables),
    };
  } catch (e) {
    return { error: e.message };
  }
}

/** "entities 36.2 MiB (18,256 rows) · credits_history 12.1 MiB (29,195 rows)" */
export function describeTables(tables = []) {
  return tables
    .map((t) => `${t.name} ${fmtScaled(t.bytes)} (${t.rows.toLocaleString()} rows)`)
    .join(' · ');
}
