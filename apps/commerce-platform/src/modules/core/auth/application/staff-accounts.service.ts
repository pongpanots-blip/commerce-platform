import { BadRequestException, ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';
import { In, Repository } from 'typeorm';
import { AuditLog } from '../../audit/infrastructure/audit-log.entity';
import { User } from '../../user/infrastructure/user.entity';
import { STAFF_ROLES, StaffRole } from '../../../../shared-kernel/presentation/auth.decorators';
import { RefreshTokenService } from './refresh-token.service';

export type StaffStatus = 'active' | 'disabled';
export interface StaffAccount { id: string; email: string; name: string | null; role: StaffRole; status: StaffStatus; mustChangePassword: boolean; createdAt: Date }
export interface StaffActor { userId: string; email: string }

export const MIN_PASSWORD = 10;
const temporaryPassword = () => randomBytes(12).toString('base64url');
const view = (u: User): StaffAccount => ({ id: u.id, email: u.email, name: u.name, role: u.role as StaffRole, status: u.status as StaffStatus, mustChangePassword: !!u.mustChangePassword, createdAt: u.createdAt });

/**
 * commerce-admin staff accounts (admin / marketing) — commerce's own, nothing shared with josh.
 * New accounts and resets get a random temporary password, returned once and never stored or logged,
 * and must change it at first sign-in (the guard lets nothing else through until they do).
 * An admin cannot lock themselves out, and the last active admin cannot be removed or demoted.
 * Disabling, a role change and a password reset end every sign-in of the account (its refresh tokens).
 */
@Injectable()
export class StaffAccountsService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(AuditLog) private readonly audit: Repository<AuditLog>,
    private readonly sessions: RefreshTokenService,
  ) {}

  async list(): Promise<StaffAccount[]> {
    const rows = await this.users.find({ where: { role: In([...STAFF_ROLES]) }, order: { createdAt: 'ASC' } });
    return rows.map(view);
  }

  async create(input: { email: string; name?: string | null; role: StaffRole }, actor: StaffActor) {
    const email = input.email.trim().toLowerCase();
    if (await this.users.findOne({ where: { email }, withDeleted: true })) throw new ConflictException(`${email} already has an account`);
    const password = temporaryPassword();
    const saved = await this.users.save(this.users.create({
      email, name: input.name?.trim() || null, role: input.role, status: 'active', passwordHash: await bcrypt.hash(password, 10), mustChangePassword: true,
    }));
    await this.log(actor, 'staff.create', saved.id, null, { email, role: input.role });
    return { account: view(saved), temporaryPassword: password };
  }

  async update(id: string, changes: { name?: string | null; role?: StaffRole; status?: StaffStatus }, actor: StaffActor) {
    const user = await this.staff(id);
    const before = view(user);
    const losesAdmin = user.role === 'admin' && user.status === 'active'
      && ((changes.role && changes.role !== 'admin') || changes.status === 'disabled');
    if (losesAdmin && id === actor.userId) throw new BadRequestException('you cannot remove your own admin access');
    if (losesAdmin && (await this.users.count({ where: { role: 'admin', status: 'active' } })) <= 1) {
      throw new BadRequestException('this is the last active admin');
    }
    if (changes.name !== undefined) user.name = changes.name?.trim() || null;
    if (changes.role) user.role = changes.role;
    if (changes.status) user.status = changes.status;
    const saved = await this.users.save(user);
    if (saved.status !== 'active' && before.status === 'active') await this.sessions.revokeAllForUser(id, 'disabled');
    else if (saved.role !== before.role) await this.sessions.revokeAllForUser(id, 'role_changed');
    await this.log(actor, 'staff.update', id, before, view(saved));
    return view(saved);
  }

  async resetPassword(id: string, actor: StaffActor) {
    const user = await this.staff(id);
    const password = temporaryPassword();
    user.passwordHash = await bcrypt.hash(password, 10);
    user.mustChangePassword = true;
    await this.users.save(user);
    await this.sessions.revokeAllForUser(id, 'password_reset');
    await this.log(actor, 'staff.reset_password', id, null, { email: user.email });
    return { temporaryPassword: password };
  }

  /** Ends every other sign-in of the account; this one carries on with the new session in the response. */
  async changeOwnPassword(actor: StaffActor, current: string, next: string) {
    if (next.length < MIN_PASSWORD) throw new BadRequestException(`new password: at least ${MIN_PASSWORD} characters`);
    const user = await this.staff(actor.userId);
    if (!user.passwordHash || !(await bcrypt.compare(current, user.passwordHash))) throw new UnauthorizedException('current password is wrong');
    if (await bcrypt.compare(next, user.passwordHash)) throw new BadRequestException('new password must differ from the current one');
    user.passwordHash = await bcrypt.hash(next, 10);
    user.mustChangePassword = false;
    const saved = await this.users.save(user);
    await this.sessions.revokeAllForUser(user.id, 'password_changed');
    await this.log(actor, 'staff.change_own_password', user.id, null, null);
    return { changed: true, ...(await this.sessions.issueSession(saved, 'staff')) };
  }

  private async staff(id: string): Promise<User> {
    const user = await this.users.findOne({ where: { id } });
    if (!user || !STAFF_ROLES.includes(user.role as StaffRole)) throw new NotFoundException('staff account not found');
    return user;
  }

  private log(actor: StaffActor, action: string, entityId: string, before: object | null, after: object | null) {
    return this.audit.insert({ actorId: actor.userId, action, entityType: 'staff_account', entityId, before, after, context: { email: actor.email } });
  }
}
