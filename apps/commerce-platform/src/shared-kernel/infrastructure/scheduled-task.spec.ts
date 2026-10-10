import { Logger } from '@nestjs/common';
import { SCHEDULE_CRON_OPTIONS } from '@nestjs/schedule/dist/schedule.constants';
import { ScheduledCron, ScheduledInterval, TaskAwareLogger, runManually, scheduledTaskState } from './scheduled-task';

class Jobs {
  calls = 0;
  @ScheduledCron('t-ok', '0 * * * *', { timeZone: 'Asia/Bangkok' })
  async ok() { this.calls++; return 'done'; }

  @ScheduledCron('t-throws', '0 * * * *', { disabled: true })
  async throws() { throw new Error('boom'); }

  @ScheduledCron('t-swallows', '0 * * * *')
  async swallows() {
    try { throw new Error('josh down'); } catch (e) { new Logger('Jobs').warn(`sync failed: ${(e as Error).message}\n    at Jobs.swallows (jobs.ts:1:1)`); }
  }

  @ScheduledInterval('t-interval', 5000)
  async tick() { /* nothing */ }
}

describe('scheduled task tracking', () => {
  beforeAll(() => Logger.overrideLogger(new TaskAwareLogger()));
  afterAll(() => Logger.overrideLogger(['log', 'error', 'warn', 'debug', 'verbose']));
  const jobs = new Jobs();

  it('keeps @Cron metadata with the name as the registry key, and `this`/return value', async () => {
    expect(Reflect.getMetadata(SCHEDULE_CRON_OPTIONS, Jobs.prototype.ok)).toMatchObject({ name: 't-ok', cronTime: '0 * * * *', timeZone: 'Asia/Bangkok' });
    await expect(jobs.ok()).resolves.toBe('done');
    expect(jobs.calls).toBe(1);
    const s = scheduledTaskState('t-ok')!;
    expect(s).toMatchObject({ kind: 'cron', runs: 1, problems: 0, running: 0, disabled: false });
    expect(s.lastSuccessAt).toEqual(s.last!.endedAt);
  });

  it('records a thrown error and still rethrows it', async () => {
    await expect(jobs.throws()).rejects.toThrow('boom');
    expect(scheduledTaskState('t-throws')).toMatchObject({ disabled: true, problems: 1, lastSuccessAt: null, lastProblem: { message: 'boom' } });
  });

  it('marks a run that only logged a warning as a problem', async () => {
    await jobs.swallows();
    expect(scheduledTaskState('t-swallows')!.lastProblem?.message).toBe('sync failed: josh down');
  });

  it('flags manual runs and counts running while in flight', async () => {
    const pending = runManually(() => jobs.ok());
    expect(scheduledTaskState('t-ok')!.running).toBe(1);
    await pending;
    expect(scheduledTaskState('t-ok')!.last!.manual).toBe(true);
    await jobs.ok();
    expect(scheduledTaskState('t-ok')!.last!.manual).toBe(false);
  });

  it('registers intervals and rejects a duplicate name', () => {
    expect(scheduledTaskState('t-interval')).toMatchObject({ kind: 'interval', intervalMs: 5000 });
    expect(() => ScheduledInterval('t-interval', 1)(Jobs.prototype, 'tick', { value: () => undefined })).toThrow('used twice');
  });
});
