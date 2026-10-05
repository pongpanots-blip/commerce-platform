import {
  getLogContext,
  isVisibleApiLogDoc,
  normalizeApiLogDoc,
} from './api-log-normalize.util';

describe('api-log-normalize.util', () => {
  it('flatten metadata.metadata จาก winston', () => {
    const normalized = normalizeApiLogDoc({
      message: 'API Success: [GET] /api/cart',
      metadata: {
        context: 'HttpLoggingInterceptor',
        metadata: {
          method: 'GET',
          url: '/api/cart',
          statusCode: 200,
          duration_ms: 15,
          is_success: true,
        },
      },
      createdAt: new Date('2026-08-24T10:00:00.000Z'),
    });

    expect(normalized.method).toBe('GET');
    expect(normalized.url).toBe('/api/cart');
    expect(normalized.statusCode).toBe(200);
    expect(normalized.durationMs).toBe(15);
  });

  it('parse method/url จาก message เมื่อ metadata ไม่มี url', () => {
    const normalized = normalizeApiLogDoc({
      message: 'API Failed: [POST] /api/checkout/submit',
      metadata: { statusCode: 422, is_success: false },
      timestamp: new Date('2026-08-24T11:00:00.000Z'),
    });

    expect(normalized.method).toBe('POST');
    expect(normalized.url).toBe('/api/checkout/submit');
    expect(normalized.statusCode).toBe(422);
  });

  it('ตัด ERP inbound ออกจาก HttpLoggingInterceptor แม้ context จะตรง (กันซ้ำกับ erp_inbound_logs)', () => {
    expect(
      isVisibleApiLogDoc({
        context: 'HttpLoggingInterceptor',
        message: 'ERP inbound OK: [PUT] /api/erp/products/qty',
        metadata: { url: '/api/erp/products/qty' },
      }),
    ).toBe(false);
  });

  it('รับ HttpLoggingInterceptor ปกติ', () => {
    expect(getLogContext({ context: 'HttpLoggingInterceptor' })).toBe(
      'HttpLoggingInterceptor',
    );
    expect(
      isVisibleApiLogDoc({
        context: 'HttpLoggingInterceptor',
        message: 'API Success: [GET] /api/product',
        metadata: { url: '/api/product', statusCode: 200 },
      }),
    ).toBe(true);
  });

  it('รับ ErpInboundLog (401 rejection จาก ErpKeyGuard พร้อม payload)', () => {
    const doc = {
      context: 'ErpInboundLog',
      message: 'ERP inbound 401: [POST] /api/erp/products/qty reason=X-ERP-Key invalid or missing',
      metadata: {
        method: 'POST',
        url: '/api/erp/products/qty',
        errorMessage: 'X-ERP-Key invalid or missing',
        payload: { sku: 'ABC' },
      },
    };
    expect(isVisibleApiLogDoc(doc)).toBe(true);

    const normalized = normalizeApiLogDoc(doc);
    expect(normalized.errorMessage).toBe('X-ERP-Key invalid or missing');
    expect(normalized.payload).toEqual({ sku: 'ABC' });
    expect(normalized.source).toBe('erp_webhook');
  });

  it('รับ outbound integration clients (JagotaNodeApiService, KbankApiClient) พร้อม source ที่ถูกต้อง', () => {
    const jagotaDoc = {
      context: 'JagotaNodeApiService',
      message: 'Jagota API POST /orders → 200',
      metadata: {
        method: 'POST',
        url: '/orders',
        statusCode: 200,
        payload: { orderNo: 'JOSH-1' },
        response: { ok: true },
      },
    };
    expect(isVisibleApiLogDoc(jagotaDoc)).toBe(true);
    expect(normalizeApiLogDoc(jagotaDoc).source).toBe('jagota');
    expect(normalizeApiLogDoc(jagotaDoc).payload).toEqual({ orderNo: 'JOSH-1' });

    const kbankDoc = {
      context: 'KbankApiClient',
      message: 'KBank API GET /qr/v2/order → 400',
      metadata: { method: 'GET', url: '/qr/v2/order', statusCode: 400 },
    };
    expect(isVisibleApiLogDoc(kbankDoc)).toBe(true);
    expect(normalizeApiLogDoc(kbankDoc).source).toBe('kbank');
  });

  it('รับ JagotaOrderService (order-create gate block, ไม่มี HTTP call เกิดขึ้นจริง)', () => {
    const doc = {
      context: 'JagotaOrderService',
      message: 'Jagota order-create blocked for JOSH-1: quotation required — quotation_not_approved:Q123',
    };
    expect(isVisibleApiLogDoc(doc)).toBe(true);
    expect(normalizeApiLogDoc(doc).source).toBe('jagota');
  });

  it('ตัด context อื่นที่ไม่รู้จักออก', () => {
    expect(
      isVisibleApiLogDoc({
        context: 'SomeOtherService',
        message: 'noise',
      }),
    ).toBe(false);
  });
});
