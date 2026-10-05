import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ErpSimulatorController, SIMULATOR_ROUTES } from './erp-simulator.controller';

describe('ErpSimulatorController', () => {
  const OLD = process.env;
  const realFetch = global.fetch;
  let insert: jest.Mock;
  let ctl: ErpSimulatorController;
  const req = { staff: { userId: 'u-1', email: 'a@x', role: 'admin' } } as never;

  beforeEach(() => {
    process.env = { ...OLD, NODE_ENV: 'development', PORT: '3990', ERP_WEBHOOK_KEY: 'k-1' };
    insert = jest.fn();
    ctl = new ErpSimulatorController({ getRepository: () => ({ insert }) } as never);
    global.fetch = jest.fn().mockResolvedValue({ status: 200, text: async () => '{"received":true}' }) as never;
  });
  afterAll(() => { process.env = OLD; global.fetch = realFetch; });

  it('calls commerce\'s own ERP route with the real X-ERP-Key, returns the answer, audits who sent what', async () => {
    const payload = { PRODUCT_CODE: 'A1', QUANTITY: 5 };
    const out = await ctl.send({ route: 'PUT /erp/products/qty', payload }, req);
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('http://127.0.0.1:3990/api/erp/products/qty');
    expect(init).toMatchObject({ method: 'PUT', body: JSON.stringify(payload), headers: { 'x-erp-key': 'k-1' } });
    expect(out).toMatchObject({ route: 'PUT /erp/products/qty', status: 200, response: { received: true } });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ actorId: 'u-1', action: 'erp.simulator.send', after: payload, context: { route: 'PUT /erp/products/qty', status: 200 } }));
  });

  it('only the listed ERP routes — never an arbitrary URL; payload required', async () => {
    await expect(ctl.send({ route: 'GET /admin/secrets', payload: {} }, req)).rejects.toBeInstanceOf(BadRequestException);
    await expect(ctl.send({ route: 'POST http://evil/x', payload: {} }, req)).rejects.toBeInstanceOf(BadRequestException);
    await expect(ctl.send({ route: SIMULATOR_ROUTES[0] }, req)).rejects.toBeInstanceOf(BadRequestException);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('production: 404 unless ERP_SIMULATOR_ENABLED=true', async () => {
    process.env.NODE_ENV = 'production';
    expect(() => ctl.routes()).toThrow(NotFoundException);
    await expect(ctl.send({ route: SIMULATOR_ROUTES[0], payload: {} }, req)).rejects.toBeInstanceOf(NotFoundException);
    process.env.ERP_SIMULATOR_ENABLED = 'true';
    expect(ctl.routes().routes).toBe(SIMULATOR_ROUTES);
  });

  describe('josh → commerce → ERP', () => {
    const answer = (status: number, body: unknown) => ({ status, ok: status < 400, text: async () => JSON.stringify(body) });
    const line = { productId: 'b3f1c2a4-1234-4a5b-8c9d-abcdef012345', qty: 2, unitPrice: 100 };

    it('makes josh\'s three calls in order with josh\'s storefront key and a fresh Idempotency-Key', async () => {
      process.env.STOREFRONT_API_KEYS = 'sf-1, sf-2';
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce(answer(201, { customerId: 'c-1' }))
        .mockResolvedValueOnce(answer(201, { orderId: 'o-1', status: 'pending_payment' }))
        .mockResolvedValueOnce(answer(200, { status: 'paid' }));
      const out = await ctl.joshOrder({ customer: { name: 'ร้านทดสอบ' }, lines: [line], payment: 'paid' }, req);
      const calls = (global.fetch as jest.Mock).mock.calls;
      expect(calls.map(([u]) => u)).toEqual([
        'http://127.0.0.1:3990/api/v1/storefront/customers',
        'http://127.0.0.1:3990/api/v1/storefront/checkout',
        'http://127.0.0.1:3990/api/v1/storefront/checkout/o-1/payment-result',
      ]);
      expect(calls.every(([, i]) => i.headers['x-api-key'] === 'sf-1')).toBe(true);
      expect(calls[1][1].headers['idempotency-key']).toMatch(/^erp-sim-/);
      expect(JSON.parse(calls[1][1].body)).toMatchObject({ customerId: 'c-1', lines: [line] });
      expect(out).toMatchObject({ orderId: 'o-1', steps: [{ step: 'customer' }, { step: 'checkout' }, { step: 'payment' }] });
      expect(insert).toHaveBeenCalledWith(expect.objectContaining({ action: 'erp.simulator.josh_order', entityId: 'o-1' }));
    });

    it('stops at the first failing step; no payment when stock was not reserved', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce(answer(201, { customerId: 'c-1' }))
        .mockResolvedValueOnce(answer(201, { orderId: 'o-2', status: 'failed' }));
      const out = await ctl.joshOrder({ customer: { name: 'x' }, lines: [line] }, req);
      expect(out.steps.map((s) => s.step)).toEqual(['customer', 'checkout']);
    });

    it('validates before calling anything', async () => {
      await expect(ctl.joshOrder({ customer: {}, lines: [line] }, req)).rejects.toBeInstanceOf(BadRequestException);
      await expect(ctl.joshOrder({ customer: { name: 'x' }, lines: [] }, req)).rejects.toBeInstanceOf(BadRequestException);
      await expect(ctl.joshOrder({ customer: { name: 'x' }, lines: [line], payment: 'maybe' as never }, req)).rejects.toBeInstanceOf(BadRequestException);
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });
});
