import { ErpFallbackReplayJob } from './erp-fallback-replay.job';

describe('ErpFallbackReplayJob (stage 3)', () => {
  it('feeds a qty call through the ERP feed once, marks other paths, marks every row processed', async () => {
    const rows = [
      { id: '7', path: '/api/erp/products/qty', body: [{ PRODUCT_CODE: 'A', QUANTITY: 5, CHANGED_AT: '2026-10-07T01:00:00Z' }] },
      { id: '8', path: '/api/erp/products/qty', body: { PRODUCT_CODE: 'B', QUANTITY: 1 } },
      { id: '9', path: '/api/erp/products/price', body: [] },
    ];
    const query = jest.fn(async (sql: string, _params?: unknown[]) => (sql.startsWith('SELECT') ? rows : []));
    const feed = { receive: jest.fn().mockResolvedValue(undefined) };
    const job = new ErpFallbackReplayJob({ query } as never, feed as never);
    expect(await job.replay()).toEqual({ replayed: 2, skipped: 1 });
    expect(feed.receive).toHaveBeenNthCalledWith(1, 'qty', rows[0].body);
    expect(feed.receive).toHaveBeenNthCalledWith(2, 'qty', [rows[1].body]);
    expect(query.mock.calls.filter(([sql]) => String(sql).startsWith('UPDATE josh_erp_fallback_calls')).map(([, p]) => (p as unknown[])[0])).toEqual(['7', '8', '9']);
    expect(query.mock.calls[0][0]).toContain('WHERE processed_at IS NULL');
  });
});
