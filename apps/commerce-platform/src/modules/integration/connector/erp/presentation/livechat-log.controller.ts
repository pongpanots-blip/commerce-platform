import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LivechatLog } from './livechat-log.entity';

/** Shop live chat commerce relayed between josh and CS-CRM (admin only, the guard default). Agents still answer in CS-CRM. */
@Controller('reports/livechat')
export class LivechatLogController {
  constructor(@InjectRepository(LivechatLog) private readonly logs: Repository<LivechatLog>) {}

  @Get() async list(@Query('visitorId') visitorId?: string, @Query('page') page = '1') {
    const p = Number(page);
    if (!Number.isInteger(p) || p < 1) throw new BadRequestException('page must be a positive integer');
    const [items, total] = await this.logs.findAndCount({
      where: visitorId ? { visitorId: visitorId.slice(0, 100) } : {}, order: { createdAt: 'DESC' }, skip: (p - 1) * 100, take: 100,
      select: ['id', 'direction', 'route', 'visitorId', 'text', 'status', 'createdAt'],
    });
    return { items, total, page: p };
  }
}
