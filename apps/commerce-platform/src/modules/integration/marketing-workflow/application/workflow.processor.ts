import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { QUEUES } from '../../../../config/redis.config';
import { WorkflowEngine } from './workflow-engine.service';
import { WorkflowTriggers } from './workflow-triggers.service';

@Processor(QUEUES.MARKETING)
export class WorkflowProcessor extends WorkerHost {
  constructor(private readonly engine: WorkflowEngine, private readonly triggers: WorkflowTriggers) { super(); }
  async process(job: Job<{ enrollmentId?: string; kind?: 'customer' | 'order'; userId?: string }>): Promise<void> {
    if (job.name === 'step' && job.data.enrollmentId) return this.engine.process(job.data.enrollmentId);
    if (job.name === 'trigger' && job.data.kind && job.data.userId) return this.triggers.handle(job.data.kind, job.data.userId);
  }
}
