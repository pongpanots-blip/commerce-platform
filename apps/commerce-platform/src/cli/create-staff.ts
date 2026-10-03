/**
 * Create or update a commerce-admin staff account. Staff can't self-register
 * (portal registration only ever creates 'developer' accounts).
 *
 *   npm run create-staff -- someone@jagota.com admin
 *   npm run create-staff -- someone@jagota.com marketing
 *
 * Password: STAFF_PASSWORD env if set, otherwise a random one printed once.
 */
import 'reflect-metadata';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';
import { AppDataSource } from '../data-source';
import { User } from '../modules/core/user/infrastructure/user.entity';
import { STAFF_ROLES } from '../shared-kernel/presentation/auth.decorators';

async function main() {
  const [emailRaw, role] = process.argv.slice(2);
  if (!emailRaw || !STAFF_ROLES.includes(role as never)) {
    console.error(`usage: create-staff <email> <${STAFF_ROLES.join('|')}>`);
    process.exit(1);
  }
  const email = emailRaw.trim().toLowerCase();
  const generated = !process.env.STAFF_PASSWORD;
  const password = process.env.STAFF_PASSWORD || randomBytes(12).toString('base64url');

  await AppDataSource.initialize();
  const repo = AppDataSource.getRepository(User);
  const existing = await repo.findOne({ where: { email } });
  await repo.save(repo.create({
    ...(existing ?? {}), email, role, status: 'active', passwordHash: await bcrypt.hash(password, 10),
  }));
  await AppDataSource.destroy();

  console.log(`${existing ? 'updated' : 'created'} ${email} (${role})`);
  if (generated) console.log(`password (shown once): ${password}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
