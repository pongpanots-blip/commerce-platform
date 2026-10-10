import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { OutboxMessage } from "../../../shared-kernel/infrastructure/outbox.entity";
import { EventEmitterBus } from "../../../shared-kernel/infrastructure/event-emitter.bus";
import { JoshCustomers } from "../connector/josh/josh-customers";
import { JoshReplica } from "../connector/josh/josh-replica";
import { AssignmentWorkspaceService } from "./assignment-workspace.service";
import { SalesRepsService } from "./sales-reps.service";
export const assignmentFixtureIds = {
  company: "00000000-0000-4000-8000-000000000101",
  second: "00000000-0000-4000-8000-000000000102",
  imported: "00000000-0000-4000-8000-000000000103",
  rep: "00000000-0000-4000-8000-000000000201",
  old: "00000000-0000-4000-8000-000000000202",
  manager: "00000000-0000-4000-8000-000000000203",
  josh: "00000000-0000-4000-8000-000000000204",
};
/** Owned isolated native-field fixture only. No migrations, source credentials or external replica. */
export async function assignmentFixture(db: DataSource, schema: string) {
  if (
    !/^customer_assignment_fixture_[a-f0-9]{32}$/.test(schema) ||
    db.options.type !== "postgres" ||
    db.options.schema !== schema
  )
    throw Error("Owned assignment namespace required");
  await db.query(`CREATE SCHEMA "${schema}"`);
  for (const table of [
    "commerce_promotion_drafts",
    "commerce_promotion_draft_requests",
  ])
    await db.query(
      `CREATE TABLE "${schema}".${table}(LIKE public.${table} INCLUDING ALL)`,
    );
  await db.query(
    "ALTER TABLE commerce_promotion_draft_requests ADD CONSTRAINT assignment_fixture_receipt_fk FOREIGN KEY(draft_id) REFERENCES commerce_promotion_drafts(id)",
  );
  await db.query(
    "CREATE TABLE company_sales_reps(id uuid PRIMARY KEY,assigned_sales_user_id uuid,updated_at timestamptz NOT NULL DEFAULT now())",
  );
  await db.query(
    "CREATE TABLE josh_customers(id uuid PRIMARY KEY,data jsonb NOT NULL,deleted_at timestamptz)",
  );
  await db.query(
    "CREATE TABLE users(id uuid PRIMARY KEY,name text,role text,status text)",
  );
  await db.query(
    "CREATE TABLE josh_staff(id uuid PRIMARY KEY,first_name text,last_name text,is_active boolean,user_type text,role text)",
  );
  await db.query(
    "CREATE TABLE winback_staff_links(josh_user_id uuid PRIMARY KEY)",
  );
  await db.query(
    "CREATE TABLE company(id uuid PRIMARY KEY,name text,erp_customer_code text,assigned_sales_user_id uuid)",
  );
  for (const query of (await db.driver.createSchemaBuilder().log()).upQueries) {
    if (
      !query.query.includes(`"${schema}"`) ||
      /DROP TABLE|DROP SCHEMA|TRUNCATE/i.test(query.query)
    )
      throw Error("Fixture DDL outside owned schema");
    await db.query(query.query, query.parameters);
  }
  const ids = assignmentFixtureIds;
  for (const [id, name] of [
    [ids.company, "Synthetic North Company"],
    [ids.second, "Synthetic South Company"],
    [ids.imported, "Synthetic New Company"],
  ]) {
    await db.query("INSERT INTO company VALUES($1,$2,$3,$4)", [
      id,
      name,
      "SYNTHETIC",
      ids.old,
    ]);
    await db.query("INSERT INTO josh_customers VALUES($1,$2,NULL)", [
      randomUUID(),
      { company_id: id, role: "customer", is_active: true },
    ]);
  }
  for (const id of [ids.company, ids.second])
    await db.query(
      "INSERT INTO company_sales_reps(id,assigned_sales_user_id) VALUES($1,$2)",
      [id, ids.old],
    );
  for (const [id, name, role] of [
    [ids.rep, "Synthetic New Rep", "sale"],
    [ids.old, "Synthetic Previous Rep", "sale"],
    [ids.manager, "Synthetic Eligible Manager", "sales_manager"],
  ])
    await db.query("INSERT INTO users VALUES($1,$2,$3,$4)", [
      id,
      name,
      role,
      "active",
    ]);
  await db.query("INSERT INTO josh_staff VALUES($1,$2,$3,true,$4,$5)", [
    ids.josh,
    "Synthetic",
    "Josh Rep",
    "internal",
    "sales",
  ]);
  const companies = new JoshCustomers({
    configured: true,
    query: (sql: string, params: unknown[]) => db.query(sql, params),
  } as unknown as JoshReplica);
  const events = new EventEmitterBus(db.getRepository(OutboxMessage));
  return {
    companies,
    events,
    workspace: new AssignmentWorkspaceService(db, companies, events),
    legacy: new SalesRepsService(db, events),
    ids,
  };
}
