import { BadRequestException } from '@nestjs/common';
import { JoshMarketingWorkflowsController } from './josh-marketing-workflows.controller';

describe('JoshMarketingWorkflowsController', () => {
  const ID = '11111111-1111-4111-8111-111111111111';
  const req = { staff: { userId: 'staff-1', email: 'mkt@jagota.co.th' } } as never;

  it('activate / pause / update go to josh; nothing else (no test-send)', async () => {
    const josh = { run: jest.fn(async () => ({})) };
    const c = new JoshMarketingWorkflowsController({ available: true } as never, josh as never);
    await c.setState(ID, 'activate', req);
    await c.setState(ID, 'pause', req);
    await c.update(ID, { workflow: { name: 'x' } }, req);
    expect(() => c.setState(ID, 'test', req)).toThrow(BadRequestException);
    expect(josh.run.mock.calls.map((call) => (call as unknown[]).slice(0, 3))).toEqual([
      ['marketing-workflows', 'activate', { id: ID }],
      ['marketing-workflows', 'pause', { id: ID }],
      ['marketing-workflows', 'update', { id: ID, workflow: { name: 'x' } }],
    ]);
  });
});
