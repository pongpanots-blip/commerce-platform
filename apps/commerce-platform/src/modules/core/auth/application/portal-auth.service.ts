import { ConflictException, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from '../../user/infrastructure/user.entity';

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

/** Minimal portal auth (spec §3): bcrypt + JWT. Real SSO/verification = later. */
@Injectable()
export class PortalAuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly jwt: JwtService,
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

  async login(emailRaw: string, password: string) {
    this.assertSecret();
    const email = emailRaw.trim().toLowerCase();
    const user = await this.users.findOne({ where: { email } });
    if (!user?.passwordHash || user.status !== 'active') {
      await bcrypt.compare(password, DUMMY_HASH); // equalize timing with the real-hash path
      throw new UnauthorizedException('invalid credentials');
    }
    if (!(await bcrypt.compare(password, user.passwordHash))) {
      throw new UnauthorizedException('invalid credentials');
    }
    return {
      accessToken: await this.jwt.signAsync({ sub: user.id, email: user.email, role: user.role }),
      role: user.role,
    };
  }
}
