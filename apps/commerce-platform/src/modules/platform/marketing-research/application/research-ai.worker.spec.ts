import { ResearchAiWorker } from './research-ai.worker';
import { ResearchAiSummaryService } from './research-ai-summary.service';
import { MarketingResearchService } from './marketing-research.service';

describe('Manual Research AI worker', () => {
  const setup = () => {
    const run = {
      id: 'run',
      scope: { title: 'content' },
      report: { analysis: { requestId: 'request', attempts: 2 } },
    };
    const service = {
      claimSummary: jest.fn().mockResolvedValue(run),
      finishSummary: jest.fn(),
    };
    const ai = {
      summarize: jest
        .fn()
        .mockResolvedValue({ status: 'not_configured', reason: 'missing key' }),
    };
    const worker = new ResearchAiWorker(
      service as unknown as MarketingResearchService,
      ai as unknown as ResearchAiSummaryService,
    );
    return { worker, service, ai, run };
  };
  it('processes only an explicitly queued request and saves the matching generation', async () => {
    const { worker, service, ai, run } = setup();
    await worker.tick();
    expect(ai.summarize).toHaveBeenCalledWith(run.scope, run.report);
    expect(service.finishSummary).toHaveBeenCalledWith('run', 'request', 2, {
      status: 'not_configured',
      reason: 'missing key',
    });
    service.claimSummary.mockResolvedValue(null);
    await worker.tick();
    expect(ai.summarize).toHaveBeenCalledTimes(1);
  });
  it('does not process overlapping ticks or overwrite a lost lease', async () => {
    const { worker, service, ai } = setup();
    let resume!: () => void;
    ai.summarize.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resume = () => resolve({ status: 'completed' });
        }),
    );
    service.finishSummary.mockRejectedValue(new Error('lease expired'));
    const pending = worker.tick();
    await Promise.resolve();
    await worker.tick();
    expect(service.claimSummary).toHaveBeenCalledTimes(1);
    resume();
    await pending;
    service.claimSummary.mockResolvedValue(null);
    await worker.tick();
    expect(service.claimSummary).toHaveBeenCalledTimes(2);
  });
});
