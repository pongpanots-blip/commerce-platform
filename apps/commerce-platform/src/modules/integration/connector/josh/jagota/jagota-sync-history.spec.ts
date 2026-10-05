import { JagotaSyncHistoryImport } from './jagota-sync-history';

const row = (id: string, created_at: string, sync_status = 'sent') => ({
  id, order_id: `o-${id}`, order_number: `SO-${id}`, shipment_id: null, payment_success: true, payment_method: 'qr', request_json: { erp: {} },
  sync_status, jagota_response_json: null, transaction_type: null, doc_book: null, doc_no: null, order_taking_doc_seq: null, error_message: null,
  created_at: new Date(created_at),
});

function setup(newest: string | null, fresh: ReturnType<typeof row>[], recent: ReturnType<typeof row>[], known: string[]) {
  const replica = { configured: true, query: jest.fn().mockResolvedValueOnce(fresh).mockResolvedValueOnce(recent) };
  const history = {
    query: jest.fn().mockResolvedValue([{ newest }]),
    find: jest.fn().mockResolvedValue(known.map((id) => ({ id }))),
    upsert: jest.fn().mockResolvedValue(undefined),
  };
  return { svc: new JagotaSyncHistoryImport(replica as never, history as never), replica, history };
}

describe('JagotaSyncHistoryImport.importNew', () => {
  it('first run backfills from the oldest row and skips the refresh window', async () => {
    const { svc, replica, history } = setup(null, [row('a', '2026-01-01'), row('b', '2026-01-02')], [], []);
    expect(await svc.importNew(2)).toEqual({ added: 2, refreshed: 0 });
    expect(replica.query).toHaveBeenCalledTimes(1);
    expect(replica.query.mock.calls[0][1]).toEqual([2]);
    expect(history.upsert.mock.calls[0][0].map((h: { id: string }) => h.id)).toEqual(['a', 'b']);
  });

  it('later runs add new rows and re-read recent ones josh edited in place, once each', async () => {
    const { svc, history } = setup('2026-10-01T00:00:00Z',
      [row('b', '2026-10-01T00:00:00Z'), row('c', '2026-10-02')], [row('b', '2026-10-01T00:00:00Z', 'failed'), row('c', '2026-10-02')], ['b']);
    expect(await svc.importNew()).toEqual({ added: 1, refreshed: 2 });
    const upserted = history.upsert.mock.calls[0][0];
    expect(upserted.map((h: { id: string }) => h.id).sort()).toEqual(['b', 'c']);
    expect(upserted.find((h: { id: string }) => h.id === 'b').syncStatus).toBe('sent'); // fresh read wins over the refresh read of the same run
    expect(history.upsert.mock.calls[0][1]).toEqual(['id']);
  });

  it('nothing new: no lookup of known ids with an empty where', async () => {
    const { svc, history } = setup('2026-10-01T00:00:00Z', [], [], []);
    expect(await svc.importNew()).toEqual({ added: 0, refreshed: 0 });
    expect(history.find).not.toHaveBeenCalled();
  });
});
