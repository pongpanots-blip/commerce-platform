import { BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { JoshBackoffice } from './josh-backoffice';
import { JoshReplica } from './josh-replica';

describe('read-only payment identity lookup', () => {
  const make = (configured = true) => {
    const query = jest.fn().mockResolvedValue([{ id: 'payment-1', order_id: 'order-1', company_name: 'Synthetic company', status: 'success', amount: 100, currency: 'THB' }]);
    return { query, service: new JoshBackoffice({ configured, query } as unknown as JoshReplica) };
  };
  it('binds stable identity in one whitelisted SELECT and returns unknown freshness', async () => {
    const { query, service } = make(); const result = await service.paymentDetail('payment-1');
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/^SELECT /); expect(sql).toContain('WHERE t.id::text = $1 LIMIT 1'); expect(params).toEqual(['payment-1']);
    for (const excluded of ['gateway_response', 'password', 'card_', 'INSERT', 'UPDATE', 'DELETE']) expect(sql).not.toContain(excluded);
    expect(result).toMatchObject({ source: 'josh_replica', freshness: 'unavailable', record: { id: 'payment-1', customer_name: 'Synthetic company', status: 'success' } });
    expect(Number.isFinite(Date.parse(result.capturedAt))).toBe(true);
    expect(result).not.toHaveProperty('settlement'); expect(result).not.toHaveProperty('fees');
  });
  it.each(['', '../orders', "x'; DROP TABLE orders;--", 'a'.repeat(101), 'https://other.invalid'])('rejects invalid identity %s before any query', async id => { const { query, service } = make(); await expect(service.paymentDetail(id)).rejects.toBeInstanceOf(BadRequestException); expect(query).not.toHaveBeenCalled(); });
  it('does not fallback when the replica is unavailable', async () => { const { query, service } = make(false); await expect(service.paymentDetail('payment-1')).rejects.toBeInstanceOf(ServiceUnavailableException); expect(query).not.toHaveBeenCalled(); });
  it('returns not found for an absent identity instead of a neighboring record', async () => { const { query, service } = make(); query.mockResolvedValue([]); await expect(service.paymentDetail('payment-1')).rejects.toBeInstanceOf(NotFoundException); });
  it('does not leak database errors or retry failed reads', async () => { const { query, service } = make(); query.mockRejectedValue(new Error('private connection and SQL details')); await expect(service.paymentDetail('payment-1')).rejects.toThrow('Payment replica read failed.'); expect(query).toHaveBeenCalledTimes(1); });
});
