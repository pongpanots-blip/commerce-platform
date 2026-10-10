import { AsyncLocalStorage } from 'node:async_hooks';
import { ConsoleLogger } from '@nestjs/common';
import { Cron, Interval } from '@nestjs/schedule';

export interface TaskRun { startedAt: Date; endedAt: Date | null; problem: string | null; manual: boolean }
export interface TaskState {
  name: string;
  kind: 'cron' | 'interval';
  expression: string | null;
  timeZone: string | null;
  intervalMs: number | null;
  /** Off by config (env); the job is registered but never ticks. */
  disabled: boolean;
  running: number;
  runs: number;
  problems: number;
  last: TaskRun | null;
  lastSuccessAt: Date | null;
  lastProblem: { at: Date; message: string } | null;
}

// ponytail: in-memory, per process — resets on deploy and assumes one platform container. Move to a table for history or >1 instance.
const states = new Map<string, TaskState>();
const current = new AsyncLocalStorage<TaskRun>();
const manual = new AsyncLocalStorage<true>();
export const tasksSince = new Date();

export const scheduledTaskStates = (): TaskState[] => [...states.values()];
export const scheduledTaskState = (name: string) => states.get(name);

/** Run `fire` (which ticks the job) so the run is recorded as started by a person. */
export const runManually = <T>(fire: () => T): T => manual.run(true, fire);

/** First line only: logged errors often carry a stack trace. */
const messageOf = (m: unknown) => String(m instanceof Error ? m.message : typeof m === 'string' ? m : JSON.stringify(m)).split('\n')[0].slice(0, 500);

/** Most jobs catch their own errors and only log them; a warn/error logged during a run marks that run as a problem. */
export class TaskAwareLogger extends ConsoleLogger {
  override warn(message: unknown, ...rest: unknown[]) { note(message); super.warn(message, ...(rest as [])); }
  override error(message: unknown, ...rest: unknown[]) { note(message); super.error(message, ...(rest as [])); }
}
function note(message: unknown) {
  const run = current.getStore();
  if (run && !run.problem) run.problem = messageOf(message);
}

async function track(state: TaskState, fn: () => unknown) {
  const run: TaskRun = { startedAt: new Date(), endedAt: null, problem: null, manual: manual.getStore() === true };
  state.running++;
  state.runs++;
  state.last = run;
  try {
    return await current.run(run, fn);
  } catch (error) {
    run.problem ??= messageOf(error);
    throw error;
  } finally {
    run.endedAt = new Date();
    state.running--;
    if (run.problem) {
      state.problems++;
      state.lastProblem = { at: run.endedAt, message: run.problem };
    } else state.lastSuccessAt = run.endedAt;
  }
}

function register(name: string, meta: Pick<TaskState, 'kind' | 'expression' | 'timeZone' | 'intervalMs' | 'disabled'>, desc: PropertyDescriptor) {
  if (states.has(name)) throw new Error(`scheduled task name used twice: ${name}`);
  const state: TaskState = { name, ...meta, running: 0, runs: 0, problems: 0, last: null, lastSuccessAt: null, lastProblem: null };
  states.set(name, state);
  const original = desc.value as (...args: unknown[]) => unknown;
  desc.value = function (this: unknown, ...args: unknown[]) { return track(state, () => original.apply(this, args)); };
}

/** @Cron with a stable name (SchedulerRegistry key) and run tracking for the admin "scheduled tasks" page. */
export function ScheduledCron(name: string, expression: string, options: { timeZone?: string; disabled?: boolean } = {}): MethodDecorator {
  return (target, key, desc: PropertyDescriptor) => {
    register(name, { kind: 'cron', expression, timeZone: options.timeZone ?? null, intervalMs: null, disabled: !!options.disabled }, desc);
    Cron(expression, { ...options, name })(target, key, desc);
  };
}

/** @Interval with a stable name and run tracking. */
export function ScheduledInterval(name: string, ms: number): MethodDecorator {
  return (target, key, desc: PropertyDescriptor) => {
    register(name, { kind: 'interval', expression: null, timeZone: null, intervalMs: ms, disabled: false }, desc);
    Interval(name, ms)(target, key, desc);
  };
}
