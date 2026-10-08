import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { normalizeStaffRole } from '../../../../shared-kernel/presentation/auth.decorators';

/** Commerce and Josh logins are separate accounts. Extend this single lookup with the id-link table later. */
@Injectable()
export class SalesRepIdentity {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  async repIdsFor(staff: { userId: string; email: string; role: string }): Promise<string[]> {
    if (!['sale', 'sales_manager'].includes(normalizeStaffRole(staff.role))) return [];
    const ids = [staff.userId.trim().toLowerCase()];
    const email = staff.email.trim().toLowerCase();
    if (!email) return ids;
    // No cross-request caching: changes to staff status / mapping take effect on the next request.
    const rows: { id: string }[] = await this.db.query(
      `SELECT id FROM josh_staff WHERE lower(trim(email)) = $1 AND is_active
       AND user_type = 'internal' AND role IN ('sale', 'sales', 'manager') LIMIT 2`, [email]);
    if (rows.length === 1) ids.push(rows[0].id.toLowerCase());
    return [...new Set(ids)];
  }
}
