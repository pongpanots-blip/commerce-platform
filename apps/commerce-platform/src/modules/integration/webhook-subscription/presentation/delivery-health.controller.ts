import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { Public } from '../../../../shared-kernel/presentation/auth.decorators';
import { DeliveryMonitor } from '../application/delivery-monitor';

/**
 * For uptime monitors: 200 `{ ok: true }` while events reach platforms on time,
 * 503 with the problem kinds otherwise. Public, so it says what is wrong but
 * not the details (those go to logs and ALERT_WEBHOOK_URL).
 */
@Public()
@Controller('health')
export class DeliveryHealthController {
  constructor(private readonly monitor: DeliveryMonitor) {}

  @Get('delivery')
  async delivery() {
    const problems = await this.monitor.check();
    if (problems.length) throw new ServiceUnavailableException({ ok: false, problems: [...new Set(problems.map((p) => p.kind))] });
    return { ok: true };
  }
}
