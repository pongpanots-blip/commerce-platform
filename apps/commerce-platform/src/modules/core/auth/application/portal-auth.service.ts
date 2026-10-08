import { ConflictException, ForbiddenException, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from '../../user/infrastructure/user.entity';
import { normalizeStaffRole, STAFF_ROLES } from '../../../../shared-kernel/presentation/auth.decorators';
import { AuthSession, ClientMeta, RefreshAudience, RefreshTokenService } from './refresh-token.service';

/**
 * Compared against on login paths that have no real hash (unknown email,
 * missing hash, inactive account) so every failed login costs one bcrypt
 * compare — otherwise response timing leaks which emails exist.
 */
const DUMMY_HASH = bcrypt.hashSync('dummy-timing-password', 10);

const PG_UNIQUE_VIOLATION = '23505';

function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; driverError?: { code?: string }; message?: unknown };
  return (
    e?.driverError?.code === PG_UNIQUE_VIOLATION ||
    e?.code === PG_UNIQUE_VIOLATION ||
    (typeof e?.message === 'string' && e.message.includes('duplicate key'))
  );
}

/** Minimal portal auth (spec §3): bcrypt + short JWT + rotating refresh token. Real SSO/verification = later. */
@Injectable()
export class PortalAuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly sessions: RefreshTokenService,
  ) {}

  private assertSecret(): void {
    if (process.env.NODE_ENV === 'production' && !process.env.PORTAL_JWT_SECRET) {
      throw new ServiceUnavailableException('PORTAL_JWT_SECRET is not configured');
    }
  }

  async register(emailRaw: string, password: string) {
    this.assertSecret();
    const email = emailRaw.trim().toLowerCase();
    if (await this.users.findOne({ where: { email } })) {
      throw new ConflictException(`${email} is already registered`);
    }
    try {
      const saved = await this.users.save(this.users.create({
        email, passwordHash: await bcrypt.hash(password, 10), role: 'developer', status: 'active',
      }));
      return { accountId: saved.id, email: saved.email };
    } catch (error) {
      // TOCTOU: a concurrent register can slip between findOne and save; the
      // unique index on email is the real arbiter — map its violation to 409.
      if (isUniqueViolation(error)) {
        throw new ConflictException(`${email} is already registered`);
      }
      throw error;
    }
  }

  /** Password check shared by the admin login and the MCP OAuth login page. */
  async verifyCredentials(emailRaw: string, password: string): Promise<User> {
    const email = emailRaw.trim().toLowerCase();
    const user = await this.users.findOne({ where: { email } });
    if (!user?.passwordHash || user.status !== 'active') {
      await bcrypt.compare(password, DUMMY_HASH); // equalize timing with the real-hash path
      throw new UnauthorizedException('invalid credentials');
    }
    if (!(await bcrypt.compare(password, user.passwordHash))) {
      throw new UnauthorizedException('invalid credentials');
    }
    return user;
  }

  /**
   * Shared by the admin ('staff') and portal sign-ins. The staff audience is refused before a refresh token
   * exists for an account that cannot use commerce-admin.
   */
  async login(emailRaw: string, password: string, audience: RefreshAudience = 'portal', meta: ClientMeta = {}): Promise<AuthSession> {
    this.assertSecret();
    const user = await this.verifyCredentials(emailRaw, password);
    if (audience === 'staff' && !STAFF_ROLES.includes(normalizeStaffRole(user.role) as never)) {
      throw new ForbiddenException('not a commerce-admin account');
    }
    return this.sessions.issueSession(user, audience, meta);
  }

  refresh(refreshToken: string, audience: RefreshAudience, meta: ClientMeta = {}): Promise<AuthSession> {
    this.assertSecret();
    return this.sessions.refresh(refreshToken, audience, meta);
  }

  logout(refreshToken: string, audience: RefreshAudience) {
    return this.sessions.logout(refreshToken, audience);
  }
}
