// read-only: josh vs commerce row counts for every cutover stage's pre-flip check, plus josh migrations / outbox.
require("reflect-metadata");
const { Client } = require("pg");
(async () => {
  const j = new Client({ connectionString: process.env.JOSH_DATABASE_URL, options: "-c default_transaction_read_only=on -c statement_timeout=120000" });
  await j.connect();
  const { AppDataSource } = require("./src/data-source");
  const c = await AppDataSource.initialize();
  const one = async (db, sql) => { try { const r = db === j ? (await j.query(sql)).rows : await c.query(sql); return Object.values(r[0] || {})[0]; } catch (e) { return `ERR ${e.message.slice(0, 80)}`; } };
  const pairs = [
    ["2a customers", "SELECT count(*) FROM users u JOIN app_roles r ON r.code = u.role WHERE r.user_type = 'customer'", "SELECT count(*) FROM josh_customers WHERE deleted_at IS NULL"],
    ["2a orders", "SELECT count(*) FROM orders", "SELECT count(*) FROM josh_orders"],
    ["2a order lines", "SELECT count(*) FROM order_items", "SELECT count(*) FROM josh_order_lines"],
    ["2a segments", "SELECT count(*) FROM user_segments", "SELECT count(*) FROM segments"],
    ["2a customer_metrics", "SELECT count(*) FROM customer_metrics", "SELECT count(*) FROM customer_metrics"],
    ["2b winback_account", "SELECT count(*) FROM winback_account", "SELECT count(*) FROM winback_account"],
    ["2b winback_contact", "SELECT count(*) FROM winback_contact", "SELECT count(*) FROM winback_contact"],
    ["2b winback_activity", "SELECT count(*) FROM winback_activity", "SELECT count(*) FROM winback_activity"],
    ["2b winback_stage_history", "SELECT count(*) FROM winback_stage_history", "SELECT count(*) FROM winback_stage_history"],
    ["2b winback_sales_target", "SELECT count(*) FROM winback_sales_target", "SELECT count(*) FROM winback_sales_target"],
    ["2b winback_meeting_ack", "SELECT count(*) FROM winback_meeting_ack", "SELECT count(*) FROM winback_meeting_ack"],
    ["2b company sales reps", "SELECT count(*) FROM company WHERE assigned_sales_user_id IS NOT NULL", "SELECT count(*) FROM company_sales_reps WHERE assigned_sales_user_id IS NOT NULL"],
    ["2c company", "SELECT count(*) FROM company", "SELECT count(*) FROM josh_companies"],
    ["2c cuisine", "SELECT count(*) FROM cuisine", "SELECT count(*) FROM josh_cuisines"],
    ["2c restaurant_place", "SELECT count(*) FROM restaurant_place", "SELECT count(*) FROM josh_restaurant_places"],
    ["2c staff", "SELECT count(*) FROM users u LEFT JOIN app_roles r ON r.code = u.role WHERE r.user_type IS DISTINCT FROM 'customer'", "SELECT count(*) FROM josh_staff"],
    ["2c erp_sales_history", "SELECT count(*) FROM erp_sales_history", "SELECT count(*) FROM josh_erp_sales_history"],
    ["3 skus with stock", "SELECT count(*) FROM product_inventory WHERE product_inventory_quantity > 0", "SELECT count(DISTINCT l.product_id) FROM inventory_levels l JOIN warehouses w ON w.id = l.warehouse_id AND w.sellable WHERE l.deleted_at IS NULL AND l.quantity > l.reserved"],
    ["3 total stock qty", "SELECT coalesce(sum(greatest(product_inventory_quantity,0)),0)::bigint FROM product_inventory", "SELECT coalesce(sum(greatest(l.quantity - l.reserved,0)),0)::bigint FROM inventory_levels l JOIN warehouses w ON w.id = l.warehouse_id AND w.sellable WHERE l.deleted_at IS NULL"],
    ["3 warehouses (commerce)", "SELECT NULL", "SELECT count(*) FROM warehouses"],
    ["5 branches", "SELECT count(*) FROM branch", "SELECT count(*) FROM josh_branches"],
    ["5 push campaigns", "SELECT count(*) FROM push_campaigns", "SELECT count(*) FROM josh_push_campaigns"],
    ["5 marketing workflows", "SELECT count(*) FROM marketing_workflows", "SELECT count(*) FROM josh_marketing_workflows"],
    ["5 jagota sync history", "SELECT count(*) FROM jagota_order_sync_history", "SELECT count(*) FROM jagota_order_sync_history"],
    ["6 internal staff", "SELECT count(*) FROM users u JOIN app_roles r ON r.code = u.role WHERE r.user_type = 'internal'", "SELECT count(*) FROM josh_staff WHERE user_type = 'internal'"],
    ["4 catalog products", "SELECT count(*) FROM product_inventory", "SELECT count(*) FROM josh_catalog_products WHERE removed_at IS NULL"],
    ["4 products (commerce)", "SELECT count(*) FROM product_inventory", "SELECT count(*) FROM products"],
  ];
  const rows = [];
  for (const [k, js, cs] of pairs) { const a = await one(j, js), b = await one(c, cs); rows.push({ check: k, josh: a, commerce: b, same: String(a) === String(b) }); }
  console.table(rows);
  console.log("josh migrations ≥1792300000000:", JSON.stringify((await j.query("SELECT name FROM typeorm_migrations WHERE timestamp >= 1792300000000 ORDER BY timestamp, name")).rows.map((r) => r.name)));
  console.log("josh outbox:", JSON.stringify((await j.query("SELECT count(*) FILTER (WHERE sent_at IS NULL)::int AS unsent, count(*) FILTER (WHERE sent_at IS NULL AND last_error IS NOT NULL)::int AS erroring, left(max(last_error) FILTER (WHERE sent_at IS NULL), 200) AS err FROM commerce_outbox")).rows[0]));
  console.log("commerce migrations:", JSON.stringify((await c.query("SELECT name FROM migrations ORDER BY id")).map((r) => r.name).filter((n) => /\d{13}$/.test(n) && Number(n.slice(-13)) >= 1794000000000)));
  await j.end(); await c.destroy();
})().catch((e) => { console.error(String((e && e.message) || e)); process.exit(1); });
