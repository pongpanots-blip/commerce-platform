import { BadRequestException } from '@nestjs/common';
import { ApiLogQueryService, normalizeApiRoute } from './api-log-query.service';

const aggregateResult = (docs: unknown[]) => {
  const cursor = {
    allowDiskUse: jest.fn(() => cursor),
    exec: jest.fn().mockResolvedValue(docs),
  };
  return cursor;
};

const makeModel = () => {
  const chain = {
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue([]),
  };

  return {
    find: jest.fn().mockReturnValue(chain),
    findById: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }),
    countDocuments: jest.fn().mockResolvedValue(0),
    aggregate: jest.fn().mockReturnValue(aggregateResult([])),
    chain,
  };
};

const sampleDoc = {
  _id: 'abc',
  context: 'HttpLoggingInterceptor',
  message: 'API Success: [GET] /api/cart',
  metadata: {
    method: 'GET',
    url: '/api/cart',
    statusCode: 200,
    duration_ms: 12,
    is_success: true,
  },
  createdAt: new Date('2026-08-24T10:00:00.000Z'),
};

describe('ApiLogQueryService.list', () => {
  it('default เป็น 24 ชั่วโมงล่าสุดเมื่อไม่ส่งช่วงเวลา', async () => {
    const model = makeModel();
    const service = new ApiLogQueryService(model as never);

    await service.list({});

    const filter = model.countDocuments.mock.calls[0][0] as any;
    const timeClause = filter.$and.find((clause: any) => clause.$or?.[0]?.createdAt);
    const spanMs =
      timeClause.$or[0].createdAt.$lte - timeClause.$or[0].createdAt.$gte;
    expect(Math.round(spanMs / 3_600_000)).toBe(24);
  });

  it('กรอง status 4xx', async () => {
    const model = makeModel();
    const service = new ApiLogQueryService(model as never);

    await service.list({ status: '4xx' });

    const filter = model.countDocuments.mock.calls[0][0] as any;
    expect(filter.$and).toEqual(
      expect.arrayContaining([
        {
          $or: [
            { 'metadata.statusCode': { $gte: 400, $lt: 500 } },
            { 'metadata.metadata.statusCode': { $gte: 400, $lt: 500 } },
          ],
        },
      ]),
    );
  });

  it('กรอง source jagota เป็น context ของ Jagota เท่านั้น', async () => {
    const model = makeModel();
    const service = new ApiLogQueryService(model as never);

    await service.list({ source: 'jagota' });

    const filter = model.countDocuments.mock.calls[0][0] as any;
    expect(filter.$and).toEqual(
      expect.arrayContaining([
        {
          $or: [
            {
              context: {
                $in: ['JagotaNodeApiService', 'JagotaOrderService'],
              },
            },
            {
              'metadata.context': {
                $in: ['JagotaNodeApiService', 'JagotaOrderService'],
              },
            },
          ],
        },
      ]),
    );
  });

  it('source=all ไม่เพิ่ม filter เพิ่มเติม (มีแค่ base context + date range)', async () => {
    const model = makeModel();
    const service = new ApiLogQueryService(model as never);

    await service.list({ source: 'all' });

    const filter = model.countDocuments.mock.calls[0][0] as any;
    // base context + date range + ERP-inbound visibility
    expect(filter.$and).toHaveLength(3);
  });

  it('กรอง method POST', async () => {
    const model = makeModel();
    const service = new ApiLogQueryService(model as never);

    await service.list({ method: 'POST' });

    const filter = model.countDocuments.mock.calls[0][0] as any;
    const methodClause = filter.$and.find(
      (clause: any) => clause.$or?.[0]?.['metadata.method'],
    );
    expect(methodClause.$or[0]['metadata.method']).toBeInstanceOf(RegExp);
    expect(methodClause.$or[0]['metadata.method'].test('POST')).toBe(true);
    expect(methodClause.$or[0]['metadata.method'].test('GET')).toBe(false);
  });

  it('ค้น q ใน message และ url', async () => {
    const model = makeModel();
    const service = new ApiLogQueryService(model as never);

    await service.list({ q: 'cart' });

    const filter = model.countDocuments.mock.calls[0][0] as any;
    expect(filter.$and).toEqual(
      expect.arrayContaining([
        {
          $or: [
            { message: expect.any(RegExp) },
            { 'metadata.url': expect.any(RegExp) },
            { 'metadata.metadata.url': expect.any(RegExp) },
          ],
        },
      ]),
    );
  });

  it('แปลง document เป็น list item', async () => {
    const model = makeModel();
    model.aggregate.mockReturnValue(aggregateResult([sampleDoc]));
    const service = new ApiLogQueryService(model as never);

    const result = await service.list({});

    expect(result.items[0]).toEqual({
      id: 'abc',
      method: 'GET',
      url: '/api/cart',
      statusCode: 200,
      isSuccess: true,
      durationMs: 12,
      message: 'API Success: [GET] /api/cart',
      createdAt: '2026-08-24T10:00:00.000Z',
      source: 'internal',
      requestId: null,
      userId: null,
    });
  });

  it('ปฏิเสธช่วงเวลาที่กว้างเกิน 7 วัน', async () => {
    const model = makeModel();
    const service = new ApiLogQueryService(model as never);

    await expect(
      service.list({
        from: '2026-07-01T00:00:00.000Z',
        to: '2026-08-01T00:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('ตอบว่างเมื่อไม่มี Mongo', async () => {
    const service = new ApiLogQueryService(undefined);

    await expect(service.list({})).resolves.toEqual({
      items: [],
      total: 0,
      page: 1,
      limit: 50,
    });
  });
});

describe('ApiLogQueryService.findOne', () => {
  it('findOne map _id เป็น id', async () => {
    const validId = '507f1f77bcf86cd799439011';
    const model = makeModel();
    model.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        ...sampleDoc,
        _id: validId,
        metadata: {
          ...sampleDoc.metadata,
          response: { items: [] },
          errorMessage: 'bad request',
        },
      }),
    });
    const service = new ApiLogQueryService(model as never);

    const result = await service.findOne(validId);

    expect(result?.id).toBe(validId);
    expect(result?.response).toEqual({ items: [] });
    expect(result?.errorMessage).toBe('bad request');
  });

  it('findOne คืน null เมื่อเป็น context ที่ไม่รู้จัก', async () => {
    const validId = '507f1f77bcf86cd799439011';
    const model = makeModel();
    model.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: validId,
        context: 'SomeOtherService',
        message: 'noise',
      }),
    });
    const service = new ApiLogQueryService(model as never);

    await expect(service.findOne(validId)).resolves.toBeNull();
  });

  it('findOne คืน ERP inbound 401 rejection (context ErpInboundLog) พร้อม payload/query', async () => {
    const validId = '507f1f77bcf86cd799439011';
    const model = makeModel();
    model.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: validId,
        context: 'ErpInboundLog',
        message: 'ERP inbound 401: [POST] /api/erp/products/qty reason=X-ERP-Key invalid or missing',
        metadata: {
          method: 'POST',
          url: '/api/erp/products/qty',
          errorMessage: 'X-ERP-Key invalid or missing',
          payload: { sku: 'ABC' },
          query: { page: '1' },
        },
        createdAt: new Date('2026-08-24T10:00:00.000Z'),
      }),
    });
    const service = new ApiLogQueryService(model as never);

    const result = await service.findOne(validId);

    expect(result?.id).toBe(validId);
    expect(result?.url).toBe('/api/erp/products/qty');
    expect(result?.source).toBe('erp_webhook');
    expect(result?.payload).toEqual({ sku: 'ABC' });
    expect(result?.query).toEqual({ page: '1' });
  });

  it('findOne คืน outbound Jagota/KBank log พร้อม payload และ response', async () => {
    const validId = '507f1f77bcf86cd799439011';
    const model = makeModel();
    model.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: validId,
        context: 'JagotaNodeApiService',
        message: 'Jagota API POST /orders → 400',
        metadata: {
          method: 'POST',
          url: '/orders',
          statusCode: 400,
          payload: { orderNo: 'JOSH-1' },
          response: { error: 'bad request' },
        },
        createdAt: new Date('2026-08-24T10:00:00.000Z'),
      }),
    });
    const service = new ApiLogQueryService(model as never);

    const result = await service.findOne(validId);

    expect(result?.id).toBe(validId);
    expect(result?.source).toBe('jagota');
    expect(result?.payload).toEqual({ orderNo: 'JOSH-1' });
    expect(result?.response).toEqual({ error: 'bad request' });
  });
});

describe('normalizeApiRoute', () => {
  it('folds uuid / mongo id / numeric segments and drops the query string', () => {
    expect(
      normalizeApiRoute(
        '/api/product/3019b697-4e1c-41e0-890f-95cd2d70495a?lang=en',
      ),
    ).toBe('/api/product/:id');
    expect(normalizeApiRoute('/api/api-logs/66f0c0ffee0000000000abcd')).toBe(
      '/api/api-logs/:id',
    );
    expect(normalizeApiRoute('/api/orders/123/items')).toBe(
      '/api/orders/:id/items',
    );
  });
});

describe('ApiLogQueryService.stats', () => {
  it('merges routes that differ only by id and keeps max/avg per route', async () => {
    const model = makeModel();
    model.aggregate
      .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue([]) })
      .mockReturnValueOnce({
        exec: jest.fn().mockResolvedValue([
          { _id: { method: 'GET', path: '/api/product/1' }, count: 2, errors: 0, totalMs: 200, maxMs: 150 },
          { _id: { method: 'GET', path: '/api/product/2' }, count: 2, errors: 1, totalMs: 600, maxMs: 500 },
          { _id: { method: 'GET', path: '/api/cart' }, count: 1, errors: 0, totalMs: 900, maxMs: 900 },
        ]),
      });
    const service = new ApiLogQueryService(model as never);

    const result = await service.stats({});

    expect(result.topEndpoints).toEqual([
      { method: 'GET', route: '/api/product/:id', count: 4, errors: 1, avgMs: 200, maxMs: 500 },
    ]);
  });

  it('sorts list by duration read from either metadata depth when sort=slowest', async () => {
    const model = makeModel();
    const service = new ApiLogQueryService(model as never);

    await service.list({ sort: 'slowest' });

    const pipeline = model.aggregate.mock.calls[0][0] as any[];
    expect(pipeline.find((stage) => stage.$sort).$sort).toEqual({
      _durationMs: -1,
      createdAt: -1,
    });
    expect(JSON.stringify(pipeline)).toContain('$metadata.metadata.duration_ms');
  });
});
