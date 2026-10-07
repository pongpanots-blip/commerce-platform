import { CustomerMetricsService } from './customer-metrics.service';

describe('CustomerMetricsService.scheduled (CUSTOMER_METRICS_TO_JOSH)', () => {
  const OLD = process.env;
  afterEach(() => { process.env = OLD; });
  const make = () => {
    const svc = new CustomerMetricsService({} as never);
    const recompute = jest.spyOn(svc, 'recompute').mockResolvedValue({ changed: ['u1'] });
    const push = jest.spyOn(svc, 'push').mockResolvedValue({ sent: 1 });
    return { svc, recompute, push };
  };

  it.each([[undefined, false], ['off', false], ['shadow', true], ['on', true]])('mode %s → push %s', async (mode, pushes) => {
    process.env = { ...OLD, CUSTOMER_METRICS_TO_JOSH: mode, JOSH_API_URL: 'http://josh/api', JOSH_EVENTS_SECRET: 's' };
    if (mode === undefined) delete process.env.CUSTOMER_METRICS_TO_JOSH;
    const { svc, recompute, push } = make();
    await svc.scheduled();
    expect(recompute).toHaveBeenCalled();
    expect(push).toHaveBeenCalledTimes(pushes ? 1 : 0);
    if (pushes) expect(push).toHaveBeenCalledWith(mode);
  });

  it('a failure is logged, never thrown (josh keeps its own cron)', async () => {
    process.env = { ...OLD, CUSTOMER_METRICS_TO_JOSH: 'on', JOSH_API_URL: 'http://josh/api', JOSH_EVENTS_SECRET: 's' };
    const { svc, push } = make();
    push.mockRejectedValue(new Error('josh 503'));
    await expect(svc.scheduled()).resolves.toBeUndefined();
  });
});
