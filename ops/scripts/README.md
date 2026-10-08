# ops scripts (run by `.github/workflows/ops-platform.yml` action=script)

Each `<name>.cjs` is piped to `node -` inside the running platform container (`-w /app`), with env:
`OPS_STAFF_EMAIL` / `OPS_STAFF_PASSWORD` (staff login), `JOSH_DATABASE_URL` (josh read-only role `commerce_ro`), `SCRIPT_ARGS`.
Scripts must never print secrets.

- `http`      — `SCRIPT_ARGS='METHOD /path [json-body]'` → staff-authenticated call to the platform API
- `josh-sql`  — `SCRIPT_ARGS='SELECT …'` → one read-only query on josh (`default_transaction_read_only`)
- `josh-subscription` — `SCRIPT_ARGS='add=a,b remove=c'` → edit or create the josh webhook subscription (refuses `*` and 4f types)
- `env-names` — `SCRIPT_ARGS='NAME …'` → whether each env name is set in the platform container (booleans only)
- `env-fingerprint` — `SCRIPT_ARGS='JOSH_JWT_SECRET WINBACK_INTAKE_KEY'` → sha256 (first 12 hex) + length per value (allowlisted names; compare with josh without printing)
- `image-roundtrip` — stage 4e: upload 1 image to a josh draft SKU via commerce → josh product_media → restore → josh restored
- `seg-test`  — stage 2a: create an inactive test segment in commerce → wait for it (same id, member_count) in josh → delete → wait gone
- `winback-staff-backfill-dry` — runs `winback-staff-backfill --json` in **dry-run only** (never `--apply`, `SCRIPT_ARGS` ignored; read-only repeatable-read transaction; ids/counts only). Kept from the deleted `ops/winback-staff-backfill-dry` branch; see `docs/runbooks/saleactivity-commerce-staff-cutover.md`.
- `winback-staff-backfill-apply` — pinned to the reviewed plan: `SCRIPT_ARGS` must be exactly `'apply links=2 rows=37'` (anything else exits 2, CLI never started). Dry run → missing `counts.links`/`counts.ambiguous`/`rowsChanged` exits 2; already 0/0/ambiguous 0 exits 0 without `--apply`; anything but exactly 2/37/ambiguous 0 exits 1 → `winback-staff-backfill --apply --expect-links=2 --expect-rows=37` (app CLI, needs `WINBACK_OWNER=commerce` + `COMMERCE_OWNS_SALES_REPS=true`; re-checks the plan inside its locked transaction and rolls back on mismatch) → dry run must be empty (post-commit check, can't undo). Counts only. Tests: `node --test ops/scripts/winback-staff-backfill-apply.test.cjs`.
