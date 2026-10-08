// SCRIPT_ARGS: 'group group …' — for each group: signed POST josh /internal/commerce/backfill (postToJosh), then wait
// (read-only, ≤15 min) until josh's commerce_outbox has no unsent rows of that type. Never 'ordering'-only groups.
const ALLOWED = ["order", "customer", "catalog", "company", "cuisine", "restaurant_place", "staff", "branch", "jagota_sync", "push_campaign", "marketing_workflow", "promotion-rules", "promotion-lock"];
const { Client } = require("pg");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const groups = (process.env.SCRIPT_ARGS || "").trim().split(/\s+/).filter(Boolean);
  for (const g of groups) if (!ALLOWED.includes(g)) throw new Error(`group ${g} not allowed`);
  const { postToJosh } = require("./src/modules/integration/connector/josh/josh-api");
  const j = new Client({ connectionString: process.env.JOSH_DATABASE_URL, options: "-c default_transaction_read_only=on" });
  await j.connect();
  let bad = 0;
  try {
    for (const g of groups) {
      const t0 = Date.now();
      const r = await postToJosh("/internal/commerce/backfill", { group: g }, 900000);
      let row;
      while (Date.now() - t0 < 900000) {
        row = (await j.query("SELECT count(*) FILTER (WHERE sent_at IS NULL)::int AS unsent, count(*) FILTER (WHERE sent_at IS NULL AND last_error IS NOT NULL)::int AS erroring, left(max(last_error) FILTER (WHERE sent_at IS NULL), 200) AS err FROM commerce_outbox WHERE type = $1", [g])).rows[0];
        if (row.unsent === 0) break;
        await sleep(5000);
      }
      console.log(`${g}: enqueued ${JSON.stringify(r)} · drained=${row.unsent === 0} unsent=${row.unsent} erroring=${row.erroring}${row.err ? ` err=${row.err}` : ""} · ${Math.round((Date.now() - t0) / 1000)} s`);
      if (row.unsent !== 0) bad++;
    }
    const all = (await j.query("SELECT count(*) FILTER (WHERE sent_at IS NULL)::int AS unsent, count(*) FILTER (WHERE sent_at IS NULL AND last_error IS NOT NULL)::int AS erroring FROM commerce_outbox")).rows[0];
    console.log("josh outbox overall:", JSON.stringify(all));
  } finally { await j.end(); }
  if (bad) process.exitCode = 1;
})().catch((e) => { console.error(String((e && e.message) || e)); process.exit(1); });
