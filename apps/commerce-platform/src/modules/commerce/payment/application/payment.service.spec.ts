import { PaymentService } from './payment.service';

/**
 * Simulates the atomic conditional update: `orm.update({id, status:'pending'}, {status:to})`.
 * `updateAffected` controls whether the write "won" the race; `reReadAfterUpdate` /
 * `existingOnConflict` control what the follow-up `findOne` returns in each branch.
 */
function makeService(opts: {
  updateAffected?: number;
  reReadAfterUpdate?: { id: string; orderId: string; status: string } | null;
  existingOnConflict?: { id: string; orderId: string; status: string } | null;
} = {}) {
  const { updateAffected = 1, reReadAfterUpdate = null, existingOnConflict = null } = opts;
  const repo = {
    orm: {
      update: jest.fn().mockResolvedValue({ affected: updateAffected }),
      findOne: jest.fn().mockImplementation(async () =>
        (updateAffected > 0 ? reReadAfterUpdate : existingOnConflict)),
    },
    findMany: jest.fn(),
  };
  const saga = {
    onPaymentPaid: jest.fn().mockResolvedValue(undefined),
    onPaymentFailed: jest.fn().mockResolvedValue(undefined),
  };
  return { service: new PaymentService(repo as never, saga as never), repo, saga };
}

describe('PaymentService stub gateway', () => {
  it('markPaid: pending → paid via conditional update, then saga confirm', async () => {
    const { service, repo, saga } = makeService({
      updateAffected: 1,
      reReadAfterUpdate: { id: 'pay1', orderId: 'o1', status: 'paid' },
    });
    const res = await service.markPaid('pay1');
    expect(repo.orm.update).toHaveBeenCalledWith({ id: 'pay1', status: 'pending' }, { status: 'paid' });
    expect(res.status).toBe('paid');
    expect(saga.onPaymentPaid).toHaveBeenCalledWith('o1');
  });

  it('markFailed: pending → failed via conditional update, then saga release', async () => {
    const { service, repo, saga } = makeService({
      updateAffected: 1,
      reReadAfterUpdate: { id: 'pay1', orderId: 'o1', status: 'failed' },
    });
    const res = await service.markFailed('pay1');
    expect(repo.orm.update).toHaveBeenCalledWith({ id: 'pay1', status: 'pending' }, { status: 'failed' });
    expect(res.status).toBe('failed');
    expect(saga.onPaymentFailed).toHaveBeenCalledWith('o1');
  });

  it('rejects transitions from a non-pending payment (conditional update loses the race, affected 0) and does NOT call the saga hook', async () => {
    const { service, saga } = makeService({
      updateAffected: 0,
      existingOnConflict: { id: 'pay1', orderId: 'o1', status: 'paid' },
    });
    await expect(service.markFailed('pay1')).rejects.toThrow('pending');
    expect(saga.onPaymentFailed).not.toHaveBeenCalled();
  });

  it('404s on unknown payment (affected 0, no row on re-read)', async () => {
    const { service, saga } = makeService({ updateAffected: 0, existingOnConflict: null });
    await expect(service.markPaid('nope')).rejects.toThrow('not found');
    expect(saga.onPaymentPaid).not.toHaveBeenCalled();
  });
});
