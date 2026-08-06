# SPA Users + Credits Report — How to Run

## What this is

- **Voxel_SPA_Report_SAMPLE.xlsx** — shows the exact layout the script produces (with mock data so you can preview).
- **export_spa_report.js** — Node.js script that connects to your Postgres database, runs the SPA query, and writes a real Excel file with your live data.

## What the report contains

Three sheets:

1. **SPA Users + Credits** — one row per user who has ever received a credit grant with reason matching "spa". Columns: User ID, Email, Registered, Current Balance, # SPA Grants, Total SPA Credits Added, First/Last grant date. TOTALS row at bottom.
2. **Summary** — total users, total credits granted under SPA reason, averages.
3. **All SPA Grants (detail)** — every row from `credits_history` where reason matches "spa" (audit trail).

## How to run

Open Terminal and:

```bash
# 1. Go to your project
cd ~/my-ai-platform

# 2. Install the one new dependency (pg is already installed)
npm install exceljs

# 3. Run the script (it reads DATABASE_URL from server/.env automatically)
node /Users/voxelaimohaned/my-ai-platform/export_spa_report.js

# OR pass the database URL explicitly:
DATABASE_URL="postgresql://user:pass@host:port/db" node export_spa_report.js
```

The script will create a file named `Voxel_SPA_Users_Report_<timestamp>.xlsx` in your current folder.

## What "SPA" matches

The query filter is **case-insensitive substring match** on the `reason` column:

```sql
WHERE LOWER(COALESCE(ch.reason,'')) LIKE '%spa%'
  AND ch.amount > 0   -- only credit additions, no refunds/spends
```

So it will match: "spa", "SPA promo", "spa partnership", "salon SPA bonus", etc.

If you want a different filter (e.g. exact match only), edit line 31 of `export_spa_report.js`:

```js
const REASON_FILTER = 'spa';  // change to whatever string you want
```

## If you want to run against your local dev DB first

```bash
# Set your local DB URL
export DATABASE_URL="postgresql://localhost:5432/voxel_dev"
node export_spa_report.js
```

Then open the resulting `.xlsx` in Excel.
