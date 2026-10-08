// stage 2a check: recompute commerce customer_metrics (what the 02:30 cron does) and send every row to josh as a
// DRY RUN (josh compares with its own numbers and writes nothing). SCRIPT_ARGS='on' instead runs one real push
// (rows changed since josh last accepted them, then `done`) — only after the flag flip.
require("reflect-metadata");
(async () => {
  const mode = (process.env.SCRIPT_ARGS || "shadow").trim() || "shadow";
  if (!["shadow", "on"].includes(mode)) throw new Error("SCRIPT_ARGS must be shadow | on");
  if (mode === "on" && process.env.CUSTOMER_METRICS_TO_JOSH !== "on") throw new Error("CUSTOMER_METRICS_TO_JOSH is not on in this container");
  const { AppDataSource } = require("./src/data-source");
  const { CustomerMetricsService } = require("./src/modules/integration/customers/customer-metrics.service");
  const db = await AppDataSource.initialize();
  try {
    const svc = new CustomerMetricsService(db);
    const t0 = Date.now();
    const { changed } = await svc.recompute();
    const [{ n }] = await db.query("SELECT count(*)::int AS n FROM customer_metrics");
    console.log(JSON.stringify({ recomputed: { changed: changed.length, rows: n, ms: Date.now() - t0 } }));
    const res = await svc.push(mode);
    console.log(`customer metrics → josh (${mode}): ${JSON.stringify(res)} (${Date.now() - t0} ms)`);
  } finally { await db.destroy(); }
})().catch((e) => { console.error(String((e && e.message) || e)); process.exit(1); });
