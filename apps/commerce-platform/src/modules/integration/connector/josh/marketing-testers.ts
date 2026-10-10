import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { Setting } from '../../../core/settings/infrastructure/setting.entity';
import { StaffRequest, StaffRoles } from '../../../../shared-kernel/presentation/auth.decorators';

export interface MarketingTester { userId: string; email: string; name: string | null; addedBy: string; addedAt: string }

/**
 * josh accounts that may receive real test sends (push campaign test, workflow test with dryRun false) started from
 * commerce — admin pages, admin-call and MCP. Everyone else gets a dry run only, so a test can never reach a customer.
 * Kept in commerce's settings (marketing / testers); accounts come from the josh_users copy.
 */
@Injectable()
export class MarketingTesters {
  constructor(@InjectRepository(Setting) private readonly settings: Repository<Setting>, private readonly db: DataSource) {}

  private row() { return this.settings.findOneBy({ scope: 'marketing', key: 'testers', organizationId: IsNull() }); }

  async list(): Promise<MarketingTester[]> {
    return ((await this.row())?.value as { testers?: MarketingTester[] } | undefined)?.testers ?? [];
  }

  // ponytail: read-modify-write of one jsonb row; two staff editing in the same instant can drop one change — fine for a short list.
  private async save(testers: MarketingTester[]) {
    const row = await this.row();
    await this.settings.save({ ...(row ?? { scope: 'marketing', key: 'testers', organizationId: null }), value: { testers } });
    return testers;
  }

  async add(email: string, actor: string): Promise<MarketingTester[]> {
    const e = String(email ?? '').trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(e)) throw new BadRequestException('email ไม่ถูกต้อง');
    const [user] = await this.db.query(
      `SELECT id, email, NULLIF(trim(concat_ws(' ', first_name, last_name)), '') AS name FROM josh_users WHERE lower(email) = $1 AND is_active LIMIT 1`, [e]);
    if (!user) throw new NotFoundException(`ไม่พบบัญชี josh ที่ใช้งานอยู่ของ ${e}`);
    const testers = await this.list();
    if (testers.some((t) => t.userId === user.id)) return testers;
    return this.save([...testers, { userId: user.id, email: user.email, name: user.name, addedBy: actor, addedAt: new Date().toISOString() }]);
  }

  async remove(userId: string): Promise<MarketingTester[]> {
    return this.save((await this.list()).filter((t) => t.userId !== userId));
  }

  /** Throws unless `userId` is on the list. */
  async assert(userId: unknown): Promise<MarketingTester> {
    const tester = (await this.list()).find((t) => t.userId === userId);
    if (!tester) throw new ForbiddenException('ส่งทดสอบจริงได้เฉพาะบัญชีในรายชื่อ tester (การตลาด › ข้อความอัตโนมัติ › Tester)');
    return tester;
  }

  /** Workflow test: a real run (dryRun false) with a josh user needs a tester; dry runs and device-only runs pass. */
  async assertWorkflowTest(body: { userId?: unknown; dryRun?: unknown } | undefined) {
    if (body?.dryRun === false && body.userId) await this.assert(body.userId);
  }
}

@Controller('marketing/testers')
@StaffRoles('marketing')
export class MarketingTestersController {
  constructor(private readonly testers: MarketingTesters) {}

  @Get() list() { return this.testers.list(); }

  @Post() add(@Body() b: { email?: string }, @Req() req: StaffRequest) { return this.testers.add(b?.email ?? '', req.staff.email); }

  @Delete(':userId') remove(@Param('userId', ParseUUIDPipe) userId: string) { return this.testers.remove(userId); }
}
