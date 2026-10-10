import { ConflictException, NotFoundException } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { ScheduledCron, scheduledTaskState } from '../../../shared-kernel/infrastructure/scheduled-task';
import { ScheduledTasksController } from './scheduled-tasks.controller';

let release: () => void = () => undefined;
class Jobs {
  @ScheduledCron('c-on', '0 3 * * *')
  async on() { await new Promise<void>((r) => { release = r; }); }

  @ScheduledCron('c-off', '0 3 * * *', { disabled: true })
  async off() { /* never */ }
}

describe('ScheduledTasksController', () => {
  const jobs = new Jobs();
  const registry = new SchedulerRegistry();
  const on = CronJob.from({ cronTime: '0 3 * * *', onTick: () => jobs.on(), start: true });
  const off = CronJob.from({ cronTime: '0 3 * * *', onTick: () => jobs.off(), start: false });
  registry.addCronJob('c-on', on);
  registry.addCronJob('c-off', off);
  const insert = jest.fn(async () => undefined);
  const controller = new ScheduledTasksController(registry, { getRepository: () => ({ insert }) } as never);
  const req = { staff: { userId: 'u1', email: 'a@b.c', role: 'admin' } } as never;
  afterAll(() => { on.stop(); release(); });

  it('lists only jobs this app scheduled, with on/off and next run', () => {
    const { tasks } = controller.list();
    expect(tasks.map((t) => [t.name, t.enabled, !!t.nextRunAt])).toEqual(expect.arrayContaining([['c-on', true, true], ['c-off', false, false]]));
    expect(tasks.find((t) => t.name === 't-unregistered')).toBeUndefined();
  });

  it('runs an active job once, audits it, and refuses a second click while running', async () => {
    await expect(controller.run('c-on', req)).resolves.toEqual({ started: true });
    expect(scheduledTaskState('c-on')).toMatchObject({ running: 1, last: { manual: true } });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ actorId: 'u1', action: 'scheduled_task.run', context: { name: 'c-on', email: 'a@b.c' } }));
    await expect(controller.run('c-on', req)).rejects.toBeInstanceOf(ConflictException);
    release();
    await new Promise((r) => setImmediate(r));
    expect(scheduledTaskState('c-on')!.running).toBe(0);
  });

  it('refuses jobs turned off by config and unknown names', async () => {
    await expect(controller.run('c-off', req)).rejects.toBeInstanceOf(ConflictException);
    await expect(controller.run('nope', req)).rejects.toBeInstanceOf(NotFoundException);
    expect(insert).toHaveBeenCalledTimes(1);
  });
});
