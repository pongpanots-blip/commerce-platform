import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { erpAccepted, erpFailureReason, JagotaGateway } from './jagota-gateway';
import type { ErpCreateOrderRequest } from './erp-order-request';

const request: ErpCreateOrderRequest = {
  P_CUST_CODE: 'TMI0360', MAGENTO_ORDER_NO: '2026090700001', MAGENTO_PARENT_ORDER_NO: '', JOSH_ORDER_NO: 2026090700001,
  orderItems: [{ P_PRODUCT_CODE: '1007310', P_UNIT: 'KG', P_QTY: 2, P_RATE: 450, P_DELIVERY_DATE: '20260912', P_CUST_BRANCH_SEQ: '7', P_PO_NUMBER: '', PACKING_REMARKS: '' }],
};
const ENV = { JAGOTA_GATEWAY_ENABLED: 'true', JAGOTA_NODEAPI_BASE_URL: 'https://erp.test', JAGOTA_NODEAPI_USERNAME: 'u', JAGOTA_NODEAPI_PASSWORD: 'p' };
const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body }) as Response;

describe('erpAccepted / erpFailureReason (josh rules)', () => {
  it('accepts error:false and "already used"; reads the reason from message or data.status', () => {
    expect(erpAccepted({ error: false, data: { status: 'Waiting for conformation' } })).toBe(true);
    expect(erpAccepted({ error: true, message: 'Magento Order Id is already used' })).toBe(true);
    expect(erpAccepted({ error: true, data: { status: 'Order Creation Failed: credit' } })).toBe(false);
    expect(erpFailureReason({ error: true, data: { status: 'Order Creation Failed: credit' } })).toBe('Order Creation Failed: credit');
    expect(erpAccepted(null)).toBe(false);
    expect(erpFailureReason(null)).toBe('no response from ERP');
  });
});

describe('JagotaGateway.createOrder', () => {
  const saved = { ...process.env };
  let repo: { query: jest.Mock; findOneByOrFail: jest.Mock; update: jest.Mock };
  let fetchMock: jest.Mock;
  let gateway: JagotaGateway;

  beforeEach(() => {
    Object.assign(process.env, ENV);
    repo = { query: jest.fn().mockResolvedValue([{ id: 'row-1' }]), findOneByOrFail: jest.fn(), update: jest.fn() };
    fetchMock = jest.fn();
    global.fetch = fetchMock;
    gateway = new JagotaGateway(repo as never);
  });
  afterEach(() => { process.env = { ...saved }; });

  it('is off (503) until enabled and configured — josh then sends directly', async () => {
    delete process.env.JAGOTA_GATEWAY_ENABLED;
    await expect(gateway.createOrder(request)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(repo.query).not.toHaveBeenCalled();
  });

  it('rejects a body that is not an add-order-create request', async () => {
    await expect(gateway.createOrder({ ...request, orderItems: [] })).rejects.toBeInstanceOf(BadRequestException);
    await expect(gateway.createOrder(undefined as never)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('logs in once, sends, records sent with the doc number and returns Jagota\'s answer as is', async () => {
    const erp = { error: false, data: { status: 'ok', orderInfo: { stockProductOrder: [{ DOC_BOOK: 'SO', DOC_NO: '123' }] } } };
    fetchMock.mockResolvedValueOnce(json(200, { data: { token: 'abc' } })).mockResolvedValueOnce(json(200, erp));
    await expect(gateway.createOrder(request)).resolves.toEqual({ attempted: true, replayed: false, response: erp });
    const [loginUrl] = fetchMock.mock.calls[0];
    const [url, init] = fetchMock.mock.calls[1];
    expect(loginUrl).toBe('https://erp.test/login/b2b');
    expect(url).toBe('https://erp.test/order/add-order-create');
    expect(init.headers.token).toBe('Bearer abc');
    expect(JSON.parse(init.body)).toEqual(request);
    expect(repo.update).toHaveBeenCalledWith({ id: 'row-1' }, expect.objectContaining({ status: 'sent', docBook: 'SO', docNo: '123', lastError: null }));
  });

  it('records a refusal as failed (josh retries; the next send may claim it again)', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { token: 't' })).mockResolvedValueOnce(json(500, { error: true, message: 'ORA-00001' }));
    const answer = await gateway.createOrder(request);
    expect(answer).toEqual({ attempted: true, replayed: false, response: { error: true, message: 'ORA-00001' } });
    expect(repo.update).toHaveBeenCalledWith({ id: 'row-1' }, expect.objectContaining({ status: 'failed', lastError: 'ORA-00001' }));
  });

  it('treats "already used" as sent — the earlier send reached ERP', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { token: 't' })).mockResolvedValueOnce(json(200, { error: true, message: 'Magento Order Id is already used' }));
    await gateway.createOrder(request);
    expect(repo.update).toHaveBeenCalledWith({ id: 'row-1' }, expect.objectContaining({ status: 'sent' }));
  });

  it('replays a reference that was already sent, without calling Jagota', async () => {
    repo.query.mockResolvedValue([]);
    repo.findOneByOrFail.mockResolvedValue({ status: 'sent', response: { error: false } });
    await expect(gateway.createOrder(request)).resolves.toEqual({ attempted: true, replayed: true, response: { error: false } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('answers in_flight while another send of the reference runs', async () => {
    repo.query.mockResolvedValue([]);
    repo.findOneByOrFail.mockResolvedValue({ status: 'sending' });
    await expect(gateway.createOrder(request)).resolves.toEqual({ attempted: false, reason: 'in_flight' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('claims only new, failed or abandoned references (one SQL statement, so two callers cannot both send)', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { token: 't' })).mockResolvedValueOnce(json(200, { error: false }));
    await gateway.createOrder(request);
    const [sql, params] = repo.query.mock.calls[0];
    expect(sql).toMatch(/ON CONFLICT \(order_reference\) DO UPDATE/);
    expect(sql).toMatch(/status = 'failed'/);
    expect(sql).toMatch(/status = 'sending' AND .*updated_at </);
    expect(params[0]).toBe('2026090700001');
  });

  it('refreshes the token once on 401', async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, { token: 'old' }))
      .mockResolvedValueOnce(json(401, {}))
      .mockResolvedValueOnce(json(200, { token: 'new' }))
      .mockResolvedValueOnce(json(200, { error: false }));
    await gateway.createOrder(request);
    expect(fetchMock.mock.calls[3][1].headers.token).toBe('Bearer new');
  });

  it('records no answer (timeout / network) as failed with "no response from ERP"', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { token: 't' })).mockRejectedValueOnce(new Error('aborted'));
    await expect(gateway.createOrder(request)).resolves.toEqual({ attempted: true, replayed: false, response: null });
    expect(repo.update).toHaveBeenCalledWith({ id: 'row-1' }, expect.objectContaining({ status: 'failed', lastError: 'no response from ERP' }));
  });
});
