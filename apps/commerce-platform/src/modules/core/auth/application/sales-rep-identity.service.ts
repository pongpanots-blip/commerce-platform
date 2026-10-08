import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { normalizeStaffRole } from '../../../../shared-kernel/presentation/auth.decorators';

/** Linked staff use commerce ids. Only unlinked legacy rows need the unique email bridge. */
@Injectable()
export class SalesRepIdentity {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  async repIdsFor(staff: { userId: string; email: string; role: string }): Promise<string[]> {
    if (!['sale', 'sales_manager'].includes(normalizeStaffRole(staff.role))) return [];
    const ids = [staff.userId.trim().toLowerCase()];
    const links: { josh_user_id: string }[] = await this.db.query(
      'SELECT josh_user_id FROM winback_staff_links WHERE commerce_user_id = $1', [ids[0]]);
    // Backfill links and stored-id rewrites commit atomically, so a link means the old id is retired.
    if (links.length) return ids;
    const email = staff.email.trim().toLowerCase();
    if (!email) return ids;
    // No cross-request caching: changes to staff status / mapping take effect on the next request.
    const rows: { id: string }[] = await this.db.query(
      `SELECT id FROM josh_staff WHERE lower(trim(email)) = $1 AND is_active
       AND user_type = 'internal' AND role IN ('sale', 'sales', 'manager')
       AND NOT EXISTS (SELECT 1 FROM winback_staff_links l WHERE l.josh_user_id = josh_staff.id) LIMIT 2`, [email]);
    if (rows.length === 1) ids.push(rows[0].id.toLowerCase());
    return [...new Set(ids)];
  }
}
