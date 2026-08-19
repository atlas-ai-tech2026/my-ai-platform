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
    included: 'included in the $5/month plan',
    overage: '$0.02 per extra GiB',
    action: 'Nothing to do until it is close. Above the limit DigitalOcean bills automatically — no interruption, just a larger invoice.',
  },
  offsite: {
    label: 'Backblaze B2',
    limitBytes: 10 * GB,
    limitLabel: '10 GB free',
    included: 'the always-free allowance',
    overage: '$6.95 per TB per month',
    // The one that can actually STOP working, which is why its wording differs.
    action: 'Add a payment method to Backblaze BEFORE this is crossed. Above the free allowance without one, uploads fail and the offsite copy silently stops.',
  },
};

/** Warn at four fifths, shout at 95%. */
export const WARN_AT = 0.80;
export const CRITICAL_AT = 0.95;

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
export async function measureBucket(client, bucket, { ListObjectsV2Command, maxPages = 200 } = {}) {
  let bytes = 0;
  let objects = 0;
  let token;
  let pages = 0;
  do {
    const out = await client.send(new ListObjectsV2Command({
      Bucket: bucket, MaxKeys: 1000, ContinuationToken: token,
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
export function growthPerDay(history = []) {
  if (history.length < MIN_POINTS) return null;
  const first = history[0];
  const last = history[history.length - 1];
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

  const parts = [`${fmt(used, base)} of ${a.limitLabel} (${Math.round(pct * 100)}%)`,
    `${measurement.objects.toLocaleString()} objects`];
  if (measurement.truncated) parts.push('COUNT TRUNCATED — the real total is higher');

  if (perDay == null) {
    parts.push(`growing at an unknown rate — ${history.length} of ${MIN_POINTS} daily readings so far`);
  } else if (perDay <= 0) {
    parts.push('not growing');
  } else {
    parts.push(`growing ${fmt(perDay, base)}/day`);
    if (crossing?.already) parts.push('ALREADY OVER the allowance');
    else if (crossing) parts.push(`crosses the allowance in about ${crossing.daysLeft} days`);
  }

  // A truncated count means we do not know the size, so it cannot be a pass.
  let state = 'ok';
  if (measurement.truncated) state = 'unknown';
  else if (pct >= CRITICAL_AT) state = 'critical';
  else if (pct >= WARN_AT) state = 'warn';
  // The projection escalates on its own: comfortably inside the limit today but
  // arriving within a month is exactly the moment worth a warning, and is the
  // thing the owner actually asked for.
  else if (crossing && !crossing.already && crossing.daysLeft <= 30) state = 'warn';

  return {
    provider, label: a.label, state,
    bytes: used, objects: measurement.objects,
    pct: Math.round(pct * 1000) / 10,
    perDayBytes: perDay,
    daysLeft: crossing?.already ? 0 : (crossing?.daysLeft ?? null),
    detail: parts.join(' · '),
    action: state === 'ok' ? null : a.action,
    now,
  };
}
