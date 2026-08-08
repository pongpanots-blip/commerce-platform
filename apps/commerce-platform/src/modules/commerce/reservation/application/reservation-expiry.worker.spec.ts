import { In } from 'typeorm';
import { ReservationExpiryWorker } from './reservation-expiry.worker';

function makeWorker(
  expiredRows: { orderId: string }[],
  orderStatus = 'pending_payment',
  updateAffected = 1,
  payment: { id: string; status: string } | null = null,
  paymentUpdateAffected = 1,
) {
  const reservationRepo = { orm: { find: jest.fn().mockResolvedValue(expiredRows) } };
  const orderRepo = {
    findOne: jest.fn().mockResolvedValue({ id: 'o1', status: orderStatus }),
    update: jest.fn().mockResolvedValue({ affected: updateAffected }),
  };
  const fulfillRepo = { update: jest.fn() };
  const paymentRepo = {
    findOne: jest.fn().mockResolvedValue(payment),
    update: jest.fn().mockResolvedValue({ affected: paymentUpdateAffected }),
  };
  const dataSource = {
    getRepository: jest.fn().mockImplementation((e: { name: string }) =>
      (e.name === 'Order' ? orderRepo : e.name === 'Payment' ? paymentRepo : fulfillRepo)),
  };
  const facade = { releaseOrder: jest.fn().mockResolvedValue(undefined) };
  const worker = new ReservationExpiryWorker(
    reservationRepo as never, dataSource as never, facade as never);
  return { worker, facade, orderRepo, fulfillRepo, paymentRepo };
}

/** The conditional write: only flips orders still in a reclaimable status. */
const conditionalExpiry = [
  { id: 'o1', status: In(['pending_payment', 'reserving']) },
  { status: 'expired' },
] as const;

describe('ReservationExpiryWorker.sweep', () => {
  it('releases expired holds and expires the order via a conditional update', async () => {
    const { worker, facade, orderRepo, fulfillRepo } = makeWorker([{ orderId: 'o1' }]);
    await worker.sweep();
    expect(facade.releaseOrder).toHaveBeenCalledWith('o1', 'expired');
    expect(orderRepo.update).toHaveBeenCalledWith(...conditionalExpiry);
    expect(fulfillRepo.update).toHaveBeenCalledWith({ orderId: 'o1' }, { status: 'expired' });
  });

  it('releases orders stuck in reserving (crash before setExpiry left expiresAt provisional but past)', async () => {
    const { worker, facade, orderRepo, fulfillRepo } = makeWorker([{ orderId: 'o1' }], 'reserving');
    await worker.sweep();
    expect(facade.releaseOrder).toHaveBeenCalledWith('o1', 'expired');
    expect(orderRepo.update).toHaveBeenCalledWith(...conditionalExpiry);
    expect(fulfillRepo.update).toHaveBeenCalledWith({ orderId: 'o1' }, { status: 'expired' });
  });

  it('skips orders that already left pending_payment/reserving (paid raced the sweep)', async () => {
    const { worker, facade, orderRepo, fulfillRepo } = makeWorker([{ orderId: 'o1' }], 'confirmed');
    await worker.sweep();
    expect(facade.releaseOrder).not.toHaveBeenCalled();
    expect(orderRepo.update).not.toHaveBeenCalled();
    expect(fulfillRepo.update).not.toHaveBeenCalled();
  });

  it('does not stomp an order paid between the status read and the write (conditional update affected 0)', async () => {
    const { worker, orderRepo, fulfillRepo } = makeWorker([{ orderId: 'o1' }], 'pending_payment', 0);
    await worker.sweep();
    expect(orderRepo.update).toHaveBeenCalledWith(...conditionalExpiry);
    expect(fulfillRepo.update).not.toHaveBeenCalled();
  });

  it('does nothing when no rows are expired', async () => {
    const { worker, facade } = makeWorker([]);
    await worker.sweep();
    expect(facade.releaseOrder).not.toHaveBeenCalled();
  });

  it('skips expiry entirely when the order has a PAID payment (needs reconciliation, never overwrite money already collected)', async () => {
    const { worker, facade, orderRepo, fulfillRepo, paymentRepo } = makeWorker(
      [{ orderId: 'o1' }], 'pending_payment', 1, { id: 'pay1', status: 'paid' });
    await worker.sweep();
    expect(facade.releaseOrder).not.toHaveBeenCalled();
    expect(orderRepo.update).not.toHaveBeenCalled();
    expect(fulfillRepo.update).not.toHaveBeenCalled();
    expect(paymentRepo.update).not.toHaveBeenCalled();
  });

  it('voids a pending payment before releasing holds and expiring the order', async () => {
    const { worker, facade, orderRepo, fulfillRepo, paymentRepo } = makeWorker(
      [{ orderId: 'o1' }], 'pending_payment', 1, { id: 'pay1', status: 'pending' });
    await worker.sweep();
    expect(paymentRepo.update).toHaveBeenCalledWith({ id: 'pay1', status: 'pending' }, { status: 'failed' });
    expect(facade.releaseOrder).toHaveBeenCalledWith('o1', 'expired');
    expect(orderRepo.update).toHaveBeenCalledWith(...conditionalExpiry);
    expect(fulfillRepo.update).toHaveBeenCalledWith({ orderId: 'o1' }, { status: 'expired' });
  });
});
