import { Controller, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Public } from '../../../shared-kernel/presentation/auth.decorators';
import { StorefrontApiKeyGuard } from '../../../storefront/storefront-api-key.guard';
import { WinbackAccount } from './entities/winback-account.entity';
import { winbackOwnedByCommerce } from './shared/winback.config';

/**
 * josh tells commerce a shop user just logged in (josh AuthService.promoteWinbackAccountOnLogin,
 * once commerce runs winback): a linked TMP lead becomes a Lead — josh's exact update, on commerce's
 * table. Fire-and-forget from josh; a missed call is caught up on the user's next login.
 */
@Public()
@Controller('v1/storefront/winback')
@UseGuards(StorefrontApiKeyGuard)
export class WinbackLoginController {
  constructor(@InjectRepository(WinbackAccount) private readonly accounts: Repository<WinbackAccount>) {}

  @Post('users/:id/logged-in') @HttpCode(HttpStatus.OK)
  async loggedIn(@Param('id', ParseUUIDPipe) userId: string) {
    if (!winbackOwnedByCommerce()) return { promoted: 0, reason: 'josh runs winback' };
    const r = await this.accounts.createQueryBuilder().update(WinbackAccount)
      .set({ lifecycle: 'lead', promoted_to_lead_at: () => 'COALESCE(promoted_to_lead_at, NOW())' } as never)
      .where('josh_user_id = :uid', { uid: userId }).andWhere('lifecycle = :tmp', { tmp: 'tmp' })
      .execute();
    return { promoted: r.affected ?? 0 };
  }
}
