#!/usr/bin/env node
/**
 * Creates (or rotates) commerce's READ-ONLY user on josh's Mongo, for JOSH_MONGO_URL.
 * The user gets the built-in `read` role on josh_logs only (api_logs, notification_deliveries):
 * no writes, no index changes, no other database.
 *
 * Run once by someone holding josh's Mongo root credentials, from a machine that can reach it:
 *
 *   JOSH_MONGO_ROOT_URL='mongodb://<root>:<pw>@<host>:27017/?authSource=admin' \
 *   COMMERCE_MONGO_HOST='<host commerce will use, e.g. the db box private IP>' \
 *   node scripts/josh-mongo-readonly-user.mjs
 *
 * The new connection string is written to ./josh-mongo-url.secret (mode 600), never printed —
 * put it in commerce's env as JOSH_MONGO_URL and delete the file. Running it again rotates the password.
 */
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { MongoClient } from 'mongodb';

const USER = process.env.COMMERCE_MONGO_USER || 'commerce_ro';
const DB = process.env.JOSH_MONGO_DB || 'josh_logs';
const rootUrl = process.env.JOSH_MONGO_ROOT_URL;
if (!rootUrl) {
  console.error('JOSH_MONGO_ROOT_URL is required (josh Mongo root/admin connection string).');
  process.exit(1);
}
const root = new URL(rootUrl.replace(/^mongodb(\+srv)?:/, 'http:'));
const host = process.env.COMMERCE_MONGO_HOST || root.hostname;
const port = root.port || '27017';
const password = randomBytes(24).toString('base64url');

const client = new MongoClient(rootUrl, { serverSelectionTimeoutMS: 5000 });
try {
  await client.connect();
  const admin = client.db('admin');
  const roles = [{ role: 'read', db: DB }];
  const { users } = await admin.command({ usersInfo: USER });
  if (users.length) {
    await admin.command({ updateUser: USER, pwd: password, roles });
    console.log(`rotated password of ${USER} (read on ${DB})`);
  } else {
    await admin.command({ createUser: USER, pwd: password, roles });
    console.log(`created ${USER} (read on ${DB})`);
  }
  const userUrl = (h) => `mongodb://${USER}:${encodeURIComponent(password)}@${h}:${port}/${DB}?authSource=admin`;
  const url = userUrl(host);

  // Prove it before handing it over (via the host this machine reached): it can read, and it cannot write.
  const ro = new MongoClient(userUrl(root.hostname), { serverSelectionTimeoutMS: 5000 });
  await ro.connect();
  await ro.db(DB).collection('api_logs').findOne({});
  const canWrite = await ro.db(DB).collection('api_logs').insertOne({ probe: true }).then(() => true, () => false);
  await ro.close();
  if (canWrite) throw new Error(`${USER} can write to ${DB} — check its roles`);

  writeFileSync('josh-mongo-url.secret', `JOSH_MONGO_URL=${url}\n`, { mode: 0o600 });
  console.log('verified: reads ok, writes refused');
  console.log('wrote ./josh-mongo-url.secret — copy into commerce env (JOSH_MONGO_URL), then delete the file');
} finally {
  await client.close();
}
