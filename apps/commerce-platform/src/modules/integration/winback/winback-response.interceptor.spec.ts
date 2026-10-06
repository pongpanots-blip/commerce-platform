import { wrapWinbackResponse } from './winback-response.interceptor';

describe('wrapWinbackResponse', () => {
  it('wraps a created lead entity (POST /leads is no longer an exception)', () => {
    expect(
      wrapWinbackResponse({
        id: 'acc-1',
        customer_code: 'TMP-001',
        restaurant_place_id: 'place-1',
      }),
    ).toEqual({
      data: { id: 'acc-1', customerCode: 'TMP-001', restaurantPlaceId: 'place-1' },
    });
  });

  it('wraps a plain object', () => {
    expect(wrapWinbackResponse({ sales_user_id: 'u1', won: 2 })).toEqual({
      data: { salesUserId: 'u1', won: 2 },
    });
  });

  it('wraps arrays', () => {
    expect(wrapWinbackResponse([{ display_name: 'A' }])).toEqual({
      data: [{ displayName: 'A' }],
    });
  });

  it('wraps upload { url }', () => {
    expect(wrapWinbackResponse({ url: '/uploads/activities/file-1.jpg' })).toEqual({
      data: { url: '/uploads/activities/file-1.jpg' },
    });
  });

  it('does not double-wrap pool { data, meta }', () => {
    expect(
      wrapWinbackResponse({
        data: [{ customer_code: 'WB-1' }],
        meta: { total: 1, page: 1, limit: 20, total_pages: 1 },
      }),
    ).toEqual({
      data: [{ customerCode: 'WB-1' }],
      meta: { total: 1, page: 1, limit: 20, totalPages: 1 },
    });
  });

  it('maps undefined to { data: null }', () => {
    expect(wrapWinbackResponse(undefined)).toEqual({ data: null });
  });
});
