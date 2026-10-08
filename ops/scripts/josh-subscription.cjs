// SCRIPT_ARGS: 'add=a,b remove=c,d' — edit (or create, if none exists yet) commerce's webhook subscription that delivers
// to josh's POST /api/internal/erp-events. Created with secret = this container's JOSH_EVENTS_SECRET (the value josh
// verifies as COMMERCE_EVENTS_SECRET; never printed). Refuses ["*"] and stage-4f ordering/logistics types.
require("reflect-metadata");
const BLOCKED = ["supplier.order_periods.snapshot", "product.logistics.snapshot", "erp.order_periods.pushed"];
(async () => {
  const args = Object.fromEntries((process.env.SCRIPT_ARGS || "").trim().split(/\s+/).filter(Boolean).map((p) => p.split("=")));
  const list = (v) => (v || "").split(",").map((s) => s.trim()).filter(Boolean);
  const add = list(args.add), remove = list(args.remove);
  for (const t of add) {
    if (t === "*" || BLOCKED.includes(t) || !/^[a-z0-9_.-]+$/.test(t)) throw new Error(`refusing event type ${t}`);
  }
  const base = (process.env.JOSH_API_URL || "").replace(/\/+$/, "");
  if (!/^https?:\/\/[^@\s]+\/api$/.test(base)) throw new Error(`unexpected JOSH_API_URL shape (${base.replace(/\/\/.*@/, "//")})`);
  const target = `${base}/internal/erp-events`;
  const { AppDataSource } = require("./src/data-source");
  const db = await AppDataSource.initialize();
  try {
    await db.transaction(async (m) => {
      let subs = await m.query(`SELECT id, name, target_url, event_types, active FROM webhook_subscriptions WHERE deleted_at IS NULL AND target_url LIKE '%/internal/erp-events' FOR UPDATE`);
      if (subs.length > 1) throw new Error(`expected at most 1 josh subscription, found ${subs.length}`);
      let created = false;
      if (!subs.length) {
        if (!add.length) throw new Error("no josh subscription yet and nothing to add");
        const secret = (process.env.JOSH_EVENTS_SECRET || "").trim();
        if (!secret) throw new Error("JOSH_EVENTS_SECRET not set in the platform container");
        subs = await m.query(
          `INSERT INTO webhook_subscriptions (name, target_url, event_types, secret, active, description) VALUES ('josh', $1, '[]'::jsonb, $2, true, $3) RETURNING id, name, target_url, event_types, active`,
          [target, secret, "josh POST /api/internal/erp-events (ops cutover); signed with the josh events secret"],
        );
        created = true;
      }
      const s = subs[0];
      const before = s.event_types || [];
      if (before.includes("*")) throw new Error('josh subscription is ["*"] — not editing');
      const after = [...new Set([...before.filter((t) => !remove.includes(t)), ...add])].sort();
      await m.query(`UPDATE webhook_subscriptions SET event_types = $2::jsonb, active = true, updated_at = now() WHERE id = $1`, [s.id, JSON.stringify(after)]);
      console.log(JSON.stringify({ subscription: s.name, id: s.id, target_url: s.target_url, created, added: add.filter((t) => !before.includes(t)), removed: remove.filter((t) => before.includes(t)), before, after }, null, 1));
    });
  } finally {
    await db.destroy();
  }
})().catch((e) => { console.error(String((e && e.message) || e)); process.exit(1); });
