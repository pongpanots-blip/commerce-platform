import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Public, StaffRoles } from '../../../../shared-kernel/presentation/auth.decorators';
import { MarketingResearchService } from '../application/marketing-research.service';
import { ResearchAccessGuard, ResearchWorkerGuard } from './research.guards';
import {
  CompleteResearchRunDto,
  CreateResearchTopicDto,
  FailResearchRunDto,
  ResearchLeaseDto,
  ResearchListDto,
  ResearchRunRequestDto,
  ResearchVersionDto,
  UpdateResearchTopicDto,
} from '../dto/research.dto';
import type { ResearchActor } from '../research.types';
import type { StaffRequest as Request } from '../../../../shared-kernel/presentation/auth.decorators';

const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
});

async function reply<T>(operation: () => T | Promise<T>) {
  try {
    return { status: 200, data: await operation(), message: '' };
  } catch (error: unknown) {
    return {
      status: 200,
      data: [],
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

// The global staff guard authenticates; marketing + admin may use research.
@StaffRoles('marketing')
@Controller('marketing-research')
@UseGuards(ResearchAccessGuard)
@UsePipes(pipe)
export class MarketingResearchController {
  constructor(private readonly service: MarketingResearchService) {}

  @Get('sources')
  sources() {
    return reply(() => this.service.sources());
  }

  @Get('topics')
  list(@Query() query: ResearchListDto, @Req() req: Request) {
    const actor: ResearchActor = { sub: req.staff.userId, role: req.staff.role };
    return reply(() => this.service.list(query, actor));
  }

  @Post('topics')
  @HttpCode(200)
  create(@Body() dto: CreateResearchTopicDto, @Req() req: Request) {
    const actor: ResearchActor = { sub: req.staff.userId, role: req.staff.role };
    return reply(() => this.service.create(dto, actor));
  }

  @Get('topics/:id')
  detail(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    const actor: ResearchActor = { sub: req.staff.userId, role: req.staff.role };
    return reply(() => this.service.detail(id, actor));
  }

  @Patch('topics/:id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateResearchTopicDto,
    @Req() req: Request,
  ) {
    const actor: ResearchActor = { sub: req.staff.userId, role: req.staff.role };
    return reply(() => this.service.update(id, dto, actor));
  }

  @Post('topics/:id/archive')
  @HttpCode(200)
  archive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResearchVersionDto,
    @Req() req: Request,
  ) {
    const actor: ResearchActor = { sub: req.staff.userId, role: req.staff.role };
    return reply(() => this.service.archive(id, dto.version, actor));
  }

  @Post('topics/:id/runs')
  @HttpCode(200)
  requestRun(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResearchRunRequestDto,
    @Req() req: Request,
  ) {
    const actor: ResearchActor = { sub: req.staff.userId, role: req.staff.role };
    return reply(() => this.service.requestRun(id, dto.requestId, actor));
  }

  @Get('topics/:id/runs')
  runs(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ResearchListDto,
  ) {
    return reply(() => this.service.runs(id, query));
  }

  @Get('runs/:id')
  run(@Param('id', ParseUUIDPipe) id: string) {
    return reply(() => this.service.runDetail(id));
  }

  @Post('runs/:id/keep')
  @HttpCode(200)
  keep(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    const actor: ResearchActor = { sub: req.staff.userId, role: req.staff.role };
    return reply(() => this.service.keep(id, actor));
  }

  @Post('runs/:id/summarize')
  @HttpCode(200)
  summarize(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResearchRunRequestDto,
  ) {
    return reply(() => this.service.requestSummary(id, dto.requestId));
  }
}

@Public()
@Controller('marketing-research-worker')
@UseGuards(ResearchWorkerGuard)
@UsePipes(pipe)
export class MarketingResearchWorkerController {
  constructor(private readonly service: MarketingResearchService) {}

  @Post('claim')
  @HttpCode(200)
  claim() {
    return reply(() => this.service.claim());
  }

  @Post('runs/:id/heartbeat')
  @HttpCode(200)
  heartbeat(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResearchLeaseDto,
  ) {
    return reply(() => this.service.heartbeat(id, dto.leaseToken));
  }

  @Post('runs/:id/complete')
  @HttpCode(200)
  complete(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CompleteResearchRunDto,
  ) {
    return reply(() => this.service.finish(id, dto));
  }

  @Post('runs/:id/fail')
  @HttpCode(200)
  fail(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FailResearchRunDto,
  ) {
    return reply(() => this.service.fail(id, dto.leaseToken, dto.message));
  }
}
