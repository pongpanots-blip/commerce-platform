#!/usr/bin/env bash
# Creates (or rotates) commerce's READ-ONLY users on josh's databases. Run it ON the josh DB EC2
# (josh-db-server-prod), where josh's docker-compose.db.yml runs the `josh-postgres` and
# `josh-mongo` containers. Needs only bash + docker there (no node, no repo, no passwords typed:
# Postgres is reached over the container's local socket, Mongo with the container's own root env).
#
#   Postgres  commerce_ro: SELECT on every table in `public` (and tables josh's migrations add
#             later), read-only sessions, 60s statement timeout, max 20 connections.
#   Mongo     commerce_ro: built-in `read` role on josh_logs only.
#
# Usage (as a user that can run docker):
#   COMMERCE_DB_HOST=<IP commerce's EC2 uses to reach this box, default: this box's private IP> \
#   bash josh-db-readonly-users.sh
#
# Output: ./commerce-josh-db.secret (mode 600) with JOSH_DATABASE_URL and JOSH_MONGO_URL for
# commerce's env. Passwords are never printed. Copy the file's lines into commerce's env, then
# delete it. Running again rotates both passwords (update commerce's env after).
# Then open this box's Security Group: 5432 and 27017 inbound from commerce's EC2 only.
set -euo pipefail

PG_CONTAINER=${PG_CONTAINER:-josh-postgres}
MONGO_CONTAINER=${MONGO_CONTAINER:-josh-mongo}
PG_ADMIN=${PG_ADMIN:-josh}          # POSTGRES_USER of the container (owns josh's tables)
PG_DB=${PG_DB:-josh}                # POSTGRES_DB
MONGO_DB=${MONGO_DB:-josh_logs}
ROLE=${COMMERCE_DB_USER:-commerce_ro}
HOST=${COMMERCE_DB_HOST:-$(hostname -I 2>/dev/null | awk '{print $1}')}
OUT=${OUT:-commerce-josh-db.secret}
[[ -n "$HOST" ]] || { echo "set COMMERCE_DB_HOST (the IP commerce uses to reach this box)" >&2; exit 1; }
[[ "$ROLE" =~ ^[a-z_][a-z0-9_]*$ ]] || { echo "COMMERCE_DB_USER must be a plain lowercase name" >&2; exit 1; }

rand() { head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n'; }   # 48 hex chars, URL-safe
PG_PW=$(rand)
MONGO_PW=$(rand)
umask 077
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# ---------- Postgres ----------
# SQL goes over stdin (not argv), so the password is not visible in `ps`.
docker exec -i "$PG_CONTAINER" psql -qX -v ON_ERROR_STOP=1 -U "$PG_ADMIN" -d "$PG_DB" <<SQL
SET log_statement = 'none';
DO \$\$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$ROLE') THEN
    ALTER ROLE $ROLE WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 20 PASSWORD '$PG_PW';
    RAISE NOTICE 'postgres: rotated password of $ROLE';
  ELSE
    CREATE ROLE $ROLE WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 20 PASSWORD '$PG_PW';
    RAISE NOTICE 'postgres: created $ROLE';
  END IF;
END \$\$;
ALTER ROLE $ROLE SET default_transaction_read_only = on;
ALTER ROLE $ROLE SET statement_timeout = '60s';
ALTER ROLE $ROLE SET idle_in_transaction_session_timeout = '60s';
GRANT CONNECT ON DATABASE "$PG_DB" TO $ROLE;
GRANT USAGE ON SCHEMA public TO $ROLE;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO $ROLE;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO $ROLE;
ALTER DEFAULT PRIVILEGES FOR ROLE "$PG_ADMIN" IN SCHEMA public GRANT SELECT ON TABLES TO $ROLE;
SQL

# Verify by logging in as the new role over TCP (password via env file, not argv): reads work, writes refused.
printf 'PGPASSWORD=%s\n' "$PG_PW" > "$TMP/pg.env"
pg_ro() { docker exec -i --env-file "$TMP/pg.env" "$PG_CONTAINER" psql -qtAX -h 127.0.0.1 -U "$ROLE" -d "$PG_DB" "$@"; }
TABLE=$(pg_ro -c "SELECT quote_ident(tablename) FROM pg_tables WHERE schemaname='public' ORDER BY tablename LIMIT 1")
[[ -n "$TABLE" ]] || { echo "postgres: $ROLE sees no tables in $PG_DB.public — wrong database?" >&2; exit 1; }
pg_ro -c "SELECT 1 FROM public.$TABLE LIMIT 1" >/dev/null
if pg_ro -v ON_ERROR_STOP=1 -c "BEGIN READ WRITE; DELETE FROM public.$TABLE WHERE false; ROLLBACK;" >/dev/null 2>&1; then
  echo "postgres: $ROLE CAN delete from $TABLE — check its grants, not handing it over" >&2; exit 1
fi
if pg_ro -v ON_ERROR_STOP=1 -c "BEGIN READ WRITE; CREATE TABLE public.commerce_ro_probe (x int); ROLLBACK;" >/dev/null 2>&1; then
  echo "postgres: WARN $ROLE can create tables in public (PUBLIC has CREATE, Postgres < 15). It still cannot touch josh's tables." >&2
fi
echo "postgres: verified — reads ok, writes refused"

# ---------- Mongo ----------
# Root credentials come from the container's own MONGO_INITDB_ROOT_* env; the script is on stdin.
printf 'RO_USER=%s\nRO_PW=%s\nRO_DB=%s\n' "$ROLE" "$MONGO_PW" "$MONGO_DB" > "$TMP/mongo.env"
docker exec -i --env-file "$TMP/mongo.env" "$MONGO_CONTAINER" sh -c \
  'mongosh --quiet -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin admin' <<'JS'
const user = process.env.RO_USER, pwd = process.env.RO_PW, roles = [{ role: 'read', db: process.env.RO_DB }];
if (db.getUser(user)) { db.updateUser(user, { pwd, roles }); print(`mongo: rotated password of ${user}`); }
else { db.createUser({ user, pwd, roles }); print(`mongo: created ${user}`); }
JS

docker exec -i --env-file "$TMP/mongo.env" "$MONGO_CONTAINER" sh -c \
  'mongosh --quiet -u "$RO_USER" -p "$RO_PW" --authenticationDatabase admin "$RO_DB"' <<'JS'
db.api_logs.findOne({});
let canWrite = true;
try { db.api_logs.insertOne({ commerce_ro_probe: true }); } catch (e) { canWrite = false; }
if (canWrite) { db.api_logs.deleteOne({ commerce_ro_probe: true }); print('mongo: user CAN write — check its roles'); quit(1); }
print('mongo: verified — reads ok, writes refused');
JS

# ---------- hand over ----------
cat > "$OUT" <<ENV
JOSH_DATABASE_URL=postgres://$ROLE:$PG_PW@$HOST:5432/$PG_DB
JOSH_MONGO_URL=mongodb://$ROLE:$MONGO_PW@$HOST:27017/$MONGO_DB?authSource=admin
ENV
chmod 600 "$OUT"
echo "wrote $(pwd)/$OUT (mode 600) — put both lines in commerce's env, then delete the file"
echo "next: Security Group of this box → allow 5432 and 27017 from commerce's EC2 only"
