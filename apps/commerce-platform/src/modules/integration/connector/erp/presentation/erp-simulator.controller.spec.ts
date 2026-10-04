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
});
