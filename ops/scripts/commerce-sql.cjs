// SCRIPT_ARGS: SELECT / WITH queries separated by ';;' — run read-only on the commerce DB
require("reflect-metadata");
(async () => {
  const sqls = (process.env.SCRIPT_ARGS || "").split(";;").map((s) => s.trim()).filter(Boolean);
  if (!sqls.length || sqls.some((s) => !/^(select|with)\b/i.test(s))) throw new Error("only SELECT / WITH");
  const { AppDataSource } = require("./src/data-source");
  const db = await AppDataSource.initialize();
  try {
    for (const sql of sqls) {
      const out = await db.transaction(async (m) => { await m.query("SET TRANSACTION READ ONLY"); return m.query(sql).catch((e) => `ERR ${e.message}`); });
      console.log(`> ${sql.slice(0, 160)}\n${JSON.stringify(out, null, 1).slice(0, 15000)}`);
    }
  } finally { await db.destroy(); }
})().catch((e) => { console.error(String((e && e.message) || e)); process.exit(1); });
