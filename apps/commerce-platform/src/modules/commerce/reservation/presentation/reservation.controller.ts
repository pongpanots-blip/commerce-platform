import { Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ReservationRepository } from '../infrastructure/reservation.repository';
import { ReservationFacade } from '../application/reservation.facade';

@Controller('reservations')
export class ReservationController {
  constructor(
    private readonly repo: ReservationRepository,
    private readonly facade: ReservationFacade,
  ) {}

  @Get()
  list(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('status') status?: string,
    @Query('orderId') orderId?: string,
  ) {
    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (orderId) where.orderId = orderId;
    return this.repo.findMany({
      page: Number(page), pageSize: Number(pageSize),
      where, order: { createdAt: 'DESC' },
    });
  }

  /** Manual admin release of a single order's holds (support tool). */
  @Post(':orderId/release')
  async release(@Param('orderId', ParseUUIDPipe) orderId: string) {
    await this.facade.releaseOrder(orderId, 'released');
    return { ok: true };
  }
}
