# ops scripts (run by `.github/workflows/ops-platform.yml` action=script)

Each `<name>.cjs` is piped to `node -` inside the running platform container (`-w /app`), with env:
`OPS_STAFF_EMAIL` / `OPS_STAFF_PASSWORD` (staff login), `JOSH_DATABASE_URL` (josh read-only role `commerce_ro`), `SCRIPT_ARGS`.
Scripts must never print secrets.

- `http`      — `SCRIPT_ARGS='METHOD /path [json-body]'` → staff-authenticated call to the platform API
- `josh-sql`  — `SCRIPT_ARGS='SELECT …'` → one read-only query on josh (`default_transaction_read_only`)
- `seg-test`  — stage 2a: create an inactive test segment in commerce → wait for it (same id, member_count) in josh → delete → wait gone
