import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpTools } from './mcp.tools';

it('restaurant MCP lists with REST filters, reads details and rejects invalid busy windows through the SDK', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const missingId = '22222222-2222-4222-8222-222222222222';
  const place = { id, name: 'ร้านทดสอบ', openingHours: ['10:00-22:00'], serviceOptions: { dineIn: true, takeaway: true, delivery: false } };
  const restaurants = {
    available: true,
    list: jest.fn(async () => ({ items: [{ id, name: place.name }], summary: { totalCount: 1 }, page: 2, limit: 5 })),
    detail: jest.fn(async (placeId: string) => placeId === id ? place : null),
  };
  const tools = Object.assign(Object.create(McpTools.prototype), {
    restaurants, db: { getRepository: () => ({ insert: jest.fn(async () => undefined) }) },
  }) as McpTools;
  const server = tools.server({ userId: 'staff-1', email: 'staff@jagota.co.th', role: 'marketing' }, 'restaurant-test', []);
  const client = new Client({ name: 'restaurant-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const call = (args: Record<string, unknown>) => client.callTool({ name: 'restaurant_places', arguments: args });
  try {
    const tool = (await client.listTools()).tools.find(t => t.name === 'restaurant_places')!;
    expect(tool.annotations?.readOnlyHint).toBe(true);
    expect(tool.inputSchema.properties).toEqual(expect.objectContaining({ id: expect.anything(), maxRating: expect.anything(), maxReviewCount: expect.anything(), isEnriched: expect.anything(), dineIn: expect.anything(), takeaway: expect.anything() }));
    const filters = { search: '  ร้าน  ', district: 'วัฒนา', category: 'Japanese', minRating: 4, maxRating: 5,
      minReviewCount: 50, maxReviewCount: 500, priceRange: '฿฿', isEnriched: true, dineIn: true,
      takeaway: true, delivery: true, busyWindow: '17-20', excludeHasTmpLead: true };
    expect((await call({ ...filters, page: 2, limit: 5 })).isError).not.toBe(true);
    expect(restaurants.list).toHaveBeenCalledWith({ ...filters, search: 'ร้าน' }, 2, 5);
    await call({});
    expect(restaurants.list).toHaveBeenLastCalledWith(expect.any(Object), 1, 20);
    const detail = await call({ id });
    expect(detail.isError).not.toBe(true);
    expect(JSON.parse(String(detail.content[0].text))).toEqual(place);
    expect(restaurants.detail).toHaveBeenCalledWith(id);
    expect((await call({ id: missingId })).isError).toBe(true);
    for (const busyWindow of ['24-25', '20-17', '0-25', 'x']) {
      expect((await call({ busyWindow })).isError).toBe(true);
    }
    expect(restaurants.list).toHaveBeenCalledTimes(2);
    restaurants.available = false;
    const unavailable = await call({ id });
    expect(JSON.parse(String(unavailable.content[0].text))).toMatchObject({ available: false });
    expect(restaurants.detail).toHaveBeenCalledTimes(2);
  } finally {
    await Promise.all([client.close(), server.close()]);
  }
});
