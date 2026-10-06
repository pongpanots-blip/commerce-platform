import { Body, Controller, Get, Post, Query, UseGuards, ValidationPipe } from '@nestjs/common';
import { Throttle } from './shared/throttle';
import { Public } from './shared/public.decorator';
import { WinbackIntakeKeyGuard } from './winback-intake-key.guard';
import { IntakeLeadDto } from './dto/intake-lead.dto';
import { IntakeService } from './intake.service';
import { CuisineService } from './shared/cuisine.service';
import { CuisineCatalogQueryDto } from './shared/cuisine-catalog-query.dto';

const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });

/**
 * External lead intake.
 *
 * Separate from WinbackController because that class is entirely behind
 * AdminWriteGuard. Auth here is the shared secret in X-Winback-Key; @Public
 * skips the global ApiClientAuthGuard so the key guard is what decides.
 */
@Controller('winback/intake')
export class WinbackIntakeController {
  constructor(
    private readonly intake: IntakeService,
    private readonly cuisine: CuisineService,
  ) {}

  @Post('leads')
  @Public()
  @UseGuards(WinbackIntakeKeyGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  createLead(@Body(pipe) dto: IntakeLeadDto) {
    return this.intake.createTmpLead(dto);
  }

  /**
   * Cuisine options for the external form's dropdown, so integrators can send
   * a real `cuisine_id` instead of free text.
   *
   * Same data as GET /api/cuisine/catalog — that one sits behind the global
   * ApiClientAuthGuard, which an intake integrator holding only X-Winback-Key
   * cannot pass.
   * - no query → types + specialties (flat)
   * - ?level=1 → cuisine types only
   * - ?parent_id={uuid} → specialties under one type
   */
  @Get('cuisines')
  @Public()
  @UseGuards(WinbackIntakeKeyGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  listCuisines(@Query(pipe) query: CuisineCatalogQueryDto) {
    return this.cuisine.findCuisineHierarchy({
      parent_id: query.parent_id,
      level: query.level,
    });
  }
}
