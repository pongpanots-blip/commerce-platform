import { ConflictException, Controller, Get, HttpCode, Module, NotFoundException, Param, Post, Req } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { AuditLog } from '../audit/infrastructure/audit-log.entity';
import { runManually, scheduledTaskState, scheduledTaskStates, tasksSince } from '../../../shared-kernel/infrastructure/scheduled-task';
import type { StaffRequest } from '../../../shared-kernel/presentation/auth.decorators';

/**
 * Admin page for the jobs the platform runs on its own (crons + intervals): config, last run, last problem, Run now.
 * Admin only (default). Run state is in-memory since `since` — see scheduled-task.ts.
 */
@Controller('scheduled-tasks')
export class ScheduledTasksController {
  constructor(private readonly registry: SchedulerRegistry, private readonly db: DataSource) {}

  @Get()
  list() {
    const crons = this.registry.getCronJobs();
    const intervals = new Set(this.registry.getIntervals());
    const tasks = scheduledTaskStates()
      // Decorated in a module this app does not load → not scheduled here.
      .filter((s) => (s.kind === 'cron' ? crons.has(s.name) : intervals.has(s.name)))
      .map((s) => {
        const job = s.kind === 'cron' ? crons.get(s.name)! : null;
        return { ...s, enabled: s.kind === 'interval' || job!.isActive, nextRunAt: job?.isActive ? job.nextDate().toJSDate() : null };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    return { since: tasksSince, tasks };
  }

  /** Tick a cron job now, outside its schedule. Returns at once; the run shows up in the list. */
  @Post(':name/run')
  @HttpCode(202)
  async run(@Param('name') name: string, @Req() req: StaffRequest) {
    const state = scheduledTaskState(name);
    if (!state || state.kind !== 'cron' || !this.registry.doesExist('cron', name)) throw new NotFoundException(`no cron job named ${name}`);
    const job = this.registry.getCronJob(name);
    // Off by config usually means "another system still does this" (e.g. josh before cutover) — never run those by hand.
    if (!job.isActive) throw new ConflictException(`${name} is turned off by config`);
    if (state.running > 0) throw new ConflictException(`${name} is already running`);
    // Fire before any await so a double click sees `running` and gets 409. Not awaited: some jobs run for minutes;
    // errors are caught by @nestjs/schedule's wrapper and recorded by the tracker.
    void runManually(() => job.fireOnTick());
    await this.db.getRepository(AuditLog).insert({
      actorId: req.staff.userId, action: 'scheduled_task.run', entityType: 'scheduled_task', entityId: null,
      context: { name, email: req.staff.email },
    });
    return { started: true };
  }
}

@Module({ controllers: [ScheduledTasksController] })
export class ScheduledTasksModule {}
