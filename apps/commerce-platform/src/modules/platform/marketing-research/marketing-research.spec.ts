import 'reflect-metadata';
import { ExecutionContext } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { randomUUID } from 'node:crypto';
import { ResearchAccessGuard, ResearchWorkerGuard } from './presentation/research.guards';
import { CompleteResearchRunDto, CreateResearchTopicDto } from './dto/research.dto';
import { researchSourceStatus } from './research.types';

/*
 * Ported from josh apps/backend/src/app/marketing-research/marketing-research.spec.ts
 * ("Research validation and security boundaries"). josh's opt-in PostgreSQL
 * lifecycle suite (RESEARCH_TEST_DATABASE_URL) is not ported; the service code
 * is a verbatim copy.
 */
const envBefore = { ...process.env };
afterEach(() => { process.env = { ...envBefore }; });

const context = (headers: Record<string, string>, staff?: { userId: string; role: string }) =>
  ({ switchToHttp: () => ({ getRequest: () => ({ headers, staff }) }) }) as ExecutionContext;

describe('Research validation and security boundaries', () => {
  it('rejects whitespace questions, arbitrary sources and coerced booleans', async () => {
    const errors = await validate(plainToInstance(CreateResearchTopicDto, {
      title: '   ', kind: 'sales', sources: ['private_group'], followHourly: 'true',
    }));
    expect(errors.map((error) => error.property)).toEqual(expect.arrayContaining(['title', 'sources', 'followHourly']));
  });

  it('never marks a source ready without an enabled worker and a strong separate credential', () => {
    process.env.RESEARCH_FREE_WORKER_ENABLED = 'false';
    process.env.RESEARCH_ENABLED_SOURCES = 'google';
    process.env.RESEARCH_WORKER_ENABLED = 'true';
    process.env.RESEARCH_WORKER_TOKEN = 'short';
    expect(researchSourceStatus().every((source) => !source.ready)).toBe(true);
    expect(() => new ResearchWorkerGuard().canActivate(context({ authorization: 'Bearer short' }))).toThrow();
    process.env.RESEARCH_WORKER_TOKEN = 'verification-only-credential-32-characters';
    expect(researchSourceStatus().filter((source) => source.ready).map((source) => source.id)).toEqual(['google']);
    expect(new ResearchWorkerGuard().canActivate(context({ authorization: `Bearer ${process.env.RESEARCH_WORKER_TOKEN}` }))).toBe(true);
    expect(() => new ResearchWorkerGuard().canActivate(context({ authorization: 'Bearer incorrect' }))).toThrow();
  });

  it('requires a staff identity with the marketing or admin role', () => {
    const guard = new ResearchAccessGuard();
    expect(() => guard.canActivate(context({}))).toThrow();
    expect(() => guard.canActivate(context({}, { userId: randomUUID(), role: 'developer' }))).toThrow();
    expect(guard.canActivate(context({}, { userId: randomUUID(), role: 'marketing' }))).toBe(true);
    expect(guard.canActivate(context({}, { userId: randomUUID(), role: 'admin' }))).toBe(true);
  });

  it('rejects missing provenance, invalid URLs and unbounded report payloads', async () => {
    const errors = await validate(plainToInstance(CompleteResearchRunDto, {
      leaseToken: randomUUID(), summary: 'test',
      evidence: [{ id: 'e1', source: 'google', url: 'javascript:alert(1)', excerpt: 'test' }],
      findings: [{ text: 'uncited', evidenceIds: [] }], suggestions: [], limitations: [], coverage: [],
    }));
    expect(errors.map((error) => error.property)).toEqual(expect.arrayContaining(['evidence', 'findings', 'coverage']));
  });
});
