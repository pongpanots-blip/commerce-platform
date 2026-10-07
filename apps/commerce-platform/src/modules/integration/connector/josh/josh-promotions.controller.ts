import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { StaffRequest, StaffRoles } from '../../../../shared-kernel/presentation/auth.decorators';
import { JoshActions } from './josh-actions';
import { JoshPromotions } from './josh-promotions';
import { joshOnly } from './system-health';

const STATES = ['running', 'scheduled', 'ended', 'sold_out', 'off'];
const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});

/**
 * josh promotion mechanics: read from josh's replica, written by josh's PromotionMechanicService
 * (signed action `promotions`; josh validates with its own strict DTOs). Admin and marketing.
 */
@Controller()
@StaffRoles('marketing')
export class JoshPromotionsController {
  constructor(private readonly promotions: JoshPromotions, private readonly josh: JoshActions) {}

  private replica() {
    if (!this.promotions.available) throw joshOnly('promotions');
  }
  private as(req: StaffRequest) { return { userId: req.staff.userId, email: req.staff.email }; }

  @Get('reports/promotions') list(@Query('state') state?: string, @Query('search') search?: string) {
    this.replica();
    if (state && !STATES.includes(state)) throw new BadRequestException(`state must be one of: ${STATES.join(', ')}`);
    return this.promotions.list({ state, search });
  }

  @Get('reports/promotions/product-sets') productSets() { this.replica(); return this.promotions.productSets(); }
  @Get('reports/promotions/campaigns') campaigns() { this.replica(); return this.promotions.campaigns(); }

  @Get('reports/promotions/shadow') shadow(@Query('days') days?: string) {
    const d = days ? Number(days) : 7;
    if (!Number.isInteger(d) || d < 1 || d > 90) throw new BadRequestException('days must be 1-90');
    return this.promotions.shadow(d);
  }

  @Get('reports/promotions/:id') detail(@Param('id', ParseUUIDPipe) id: string) { this.replica(); return this.promotions.detail(id); }

  /** Body: josh's CreatePromotionMechanicDto (name, start_date, end_date, value, product_set_ids, …). */
  @Post('josh/promotions') @HttpCode(HttpStatus.OK)
  create(@Body() b: { mechanic?: unknown }, @Req() req: StaffRequest) {
    return this.josh.run('promotions', 'create', { mechanic: obj(b?.mechanic) }, this.as(req), 'admin');
  }

  /** Body: josh's UpdatePromotionMechanicDto fields to change (e.g. { is_active: false }). */
  @Post('josh/promotions/:id/update') @HttpCode(HttpStatus.OK)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() b: { changes?: unknown }, @Req() req: StaffRequest) {
    return this.josh.run('promotions', 'update', { id, changes: obj(b?.changes) }, this.as(req), 'admin');
  }

  @Post('josh/promotions/:id/remove') @HttpCode(HttpStatus.OK)
  remove(@Param('id', ParseUUIDPipe) id: string, @Req() req: StaffRequest) {
    return this.josh.run('promotions', 'remove', { id }, this.as(req), 'admin');
  }
}
