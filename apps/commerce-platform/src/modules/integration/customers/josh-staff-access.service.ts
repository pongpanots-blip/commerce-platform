import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { EVENT_BUS, IEventBus } from '../../../shared-kernel/interfaces/event-bus.interface';
import { StaffAccessSnapshot } from './staff-access-snapshot.event';

export const ownsStaff = () => process.env.COMMERCE_OWNS_STAFF === 'true';

/**
 * josh ASSIGNABLE_ADMIN_ROLES (admin-access.constants.ts) without platform_admin — that one stays a josh-side grant.
 * Do not add commerce-only roles (business_analyst, graphic, sales_manager): josh 422s a role with no internal app_roles row.
 * Sale managers in josh are `manager`. `sale` is the rep. `sales_manager` is a commerce-admin login only.
 */
export const JOSH_STAFF_ROLES = ['cs', 'marketing', 'merchandising', 'sale', 'sales', 'manager', 'admin', 'dev'] as const;
/** The account josh runs commerce's calls as — touching it would cut commerce off josh. */
export const COMMERCE_SERVICE_ACCOUNT = 'commerce-platform@system.josh.internal';

export interface JoshStaffAccount {
  id: string; email: string | null; name: string; role: string; isActive: boolean; lastAppLoginAt: string | null;
  /** commerce changed it and josh has not echoed the change back yet (staff.snapshot) */
  pending: boolean;
  updatedBy: string | null; updatedAt: string | null;
}
export interface StaffAccessChange { role?: string; isActive?: boolean; revokeSessions?: boolean }

interface Row {
  id: string; email: string | null; first_name: string | null; last_name: string | null; josh_role: string; josh_active: boolean;
  token_version: number; last_app_login_at: Date | null;
  role: string | null; is_active: boolean | null; min_token_version: number | null; updated_at: Date | null; updated_by: string | null;
}
const SELECT = `SELECT s.id, s.email, s.first_name, s.last_name, s.role AS josh_role, s.is_active AS josh_active, s.token_version,
    s.last_app_login_at, a.role, a.is_active, a.min_token_version, a.updated_at, a.updated_by
  FROM josh_staff s LEFT JOIN josh_staff_access a ON a.id = s.id WHERE s.user_type = 'internal'`;

const view = (r: Row): JoshStaffAccount => ({
  id: r.id, email: r.email, name: [r.first_name, r.last_name].filter(Boolean).join(' '),
  role: r.role ?? r.josh_role, isActive: r.is_active ?? r.josh_active,
  lastAppLoginAt: r.last_app_login_at ? new Date(r.last_app_login_at).toISOString() : null,
  pending: r.role !== null && (r.role !== r.josh_role || r.is_active !== r.josh_active || r.token_version < (r.min_token_version ?? 0)),
  updatedBy: r.updated_by, updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
});

/**
 * josh staff accounts (sales app, CS chat, josh-only CMS pages) — written by commerce from stage 6
 * (COMMERCE_OWNS_STAFF, with josh COMMERCE_OWNS_STAFF). commerce keeps its decision in josh_staff_access and tells
 * josh with `staff.access`; josh applies it to users and its trigger sends `staff.snapshot` back into josh_staff,
 * which is how `pending` clears. The list is josh's internal staff from the copy (stage 2c).
 */
@Injectable()
export class JoshStaffAccessService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    @Inject(EVENT_BUS) private readonly events: IEventBus,
  ) {}

  async list(): Promise<JoshStaffAccount[]> {
    const rows: Row[] = await this.db.query(`${SELECT} ORDER BY s.email`);
    return rows.filter((r) => r.email !== COMMERCE_SERVICE_ACCOUNT).map(view);
  }

  async set(id: string, change: StaffAccessChange, actor: { userId: string; email: string }): Promise<JoshStaffAccount> {
    if (!ownsStaff()) throw new ConflictException('josh staff accounts are still managed in josh (COMMERCE_OWNS_STAFF is not true)');
    if (change.role !== undefined && !(JOSH_STAFF_ROLES as readonly string[]).includes(change.role)) {
      throw new BadRequestException(`role: one of ${JOSH_STAFF_ROLES.join(', ')}`);
    }
    return this.db.transaction(async (m) => {
      await m.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`josh_staff_access:${id}`]);
      const [r]: Row[] = await m.query(`${SELECT} AND s.id = $1`, [id]);
      if (!r) throw new NotFoundException('ไม่พบพนักงานใน josh');
      if (r.email === COMMERCE_SERVICE_ACCOUNT) throw new BadRequestException('บัญชีระบบของ commerce แก้จากที่นี่ไม่ได้');
      const before = view(r);
      const role = change.role ?? before.role;
      const isActive = change.isActive ?? before.isActive;
      const floor = r.min_token_version ?? 0;
      const minTokenVersion = change.revokeSessions ? Math.max(r.token_version, floor) + 1 : floor;
      if (role === before.role && isActive === before.isActive && minTokenVersion === floor && r.role !== null) return before;

      const [saved] = await m.query(
        `INSERT INTO josh_staff_access (id, email, role, is_active, min_token_version, updated_at, updated_by)
         VALUES ($1, $2, $3, $4, $5, clock_timestamp(), $6)
         ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, role = EXCLUDED.role, is_active = EXCLUDED.is_active,
           min_token_version = EXCLUDED.min_token_version, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by
         RETURNING updated_at`, [id, r.email, role, isActive, minTokenVersion, actor.email]);
      const version = new Date(saved.updated_at).toISOString();
      await m.query(
        `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, before, after, context) VALUES ($1, 'josh_staff.update', 'josh_staff', $2, $3, $4, $5)`,
        [actor.userId, id, { role: before.role, isActive: before.isActive }, { role, isActive, revokeSessions: !!change.revokeSessions },
          { email: actor.email, staffEmail: r.email }]);
      await this.events.publish(new StaffAccessSnapshot({ id, email: r.email, role, isActive, minTokenVersion, version }), m);
      const [after]: Row[] = await m.query(`${SELECT} AND s.id = $1`, [id]);
      return view(after);
    });
  }
}
