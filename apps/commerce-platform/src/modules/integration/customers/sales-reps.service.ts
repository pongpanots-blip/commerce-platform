import { listStaffRoster, staffRosterSql } from '../winback/shared/winback-staff-roster';
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { DomainEvent } from '../../../shared-kernel/domain/domain-event';
import { EVENT_BUS, IEventBus } from '../../../shared-kernel/interfaces/event-bus.interface';

export const ownsSalesReps = () => process.env.COMMERCE_OWNS_SALES_REPS === 'true';

export interface CompanySalesRepPayload { companyId: string; salesUserId: string | null; assignedAt: string }
/** josh sets company.assigned_sales_user_id; latest wins (snapshot + josh's version guard on assignedAt). */
export class CompanySalesRepAssigned extends DomainEvent<CompanySalesRepPayload> {
  readonly type = 'company.sales_rep';
  constructor(payload: CompanySalesRepPayload) { super(payload.companyId, payload, { snapshot: true }); }
}

/**
 * Company → sales rep, owned by commerce from stage 2b (COMMERCE_OWNS_SALES_REPS, with josh COMMERCE_OWNS_CUSTOMERS).
 * josh CS-admin's assignSalesRep rules: the company must exist (here: in the import or the customer copy) and the rep
 * must be an active sales rep in the commerce / unlinked Josh roster; null clears. Answers in josh's shape so the hosted CS page is unchanged.
 */
@Injectable()
export class SalesRepsService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    @Inject(EVENT_BUS) private readonly events: IEventBus,
  ) {}

  /** Assignment picker: only active internal reps, with no email / phone. Managers of commerce are not reps. */
  async list(): Promise<{ id: string; name: string }[]> {
    return (await listStaffRoster(this.db, ['sale', 'sales', 'manager'])).map(({ id, name }) => ({ id, name }));
  }

  async assign(companyId: string, salesUserId: string | null) {
    if (!ownsSalesReps()) throw new ConflictException('sales reps are still assigned in josh (COMMERCE_OWNS_SALES_REPS is not true)');
    return this.db.transaction(async (m) => {
      const [company] = await m.query(
        `SELECT 1 FROM company_sales_reps WHERE id::text = $1
         UNION ALL SELECT 1 FROM josh_customers WHERE data->>'company_id' = $1 AND deleted_at IS NULL LIMIT 1`, [companyId]);
      if (!company) throw new NotFoundException('ไม่พบบริษัท');
      if (salesUserId) {
        const [rep] = await m.query(`SELECT 1 FROM (${staffRosterSql(['sale', 'sales', 'manager'])}) reps WHERE id = $2`, [['sale', 'sales', 'manager'], salesUserId]);
        if (!rep) throw new NotFoundException('ไม่พบพนักงานขาย');
      }
      await m.query(
        `INSERT INTO company_sales_reps (id, assigned_sales_user_id, updated_at) VALUES ($1, $2, now())
         ON CONFLICT (id) DO UPDATE SET assigned_sales_user_id = EXCLUDED.assigned_sales_user_id, updated_at = now()`,
        [companyId, salesUserId]);
      await this.events.publish(new CompanySalesRepAssigned({ companyId, salesUserId, assignedAt: new Date().toISOString() }), m);
      return { status: true as const, statusCode: 200 as const, message: 'กำหนดพนักงานขายสำเร็จ', data: { id: companyId, assigned_sales_user_id: salesUserId } };
    });
  }
}
