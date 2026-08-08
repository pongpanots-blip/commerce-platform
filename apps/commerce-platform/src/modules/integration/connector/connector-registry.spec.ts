import { NotFoundException } from '@nestjs/common';
import { ConnectorRegistry } from './connector-registry';
import { ExampleConnector } from './example/example.connector';

describe('ConnectorRegistry', () => {
  it('resolves a registered adapter by type', () => {
    const registry = new ConnectorRegistry();
    const example = new ExampleConnector();
    registry.register(example.type, example);
    expect(registry.resolve('example')).toBe(example);
    expect(registry.has('example')).toBe(true);
  });

  it('throws NotFound for an unknown type', () => {
    const registry = new ConnectorRegistry();
    expect(() => registry.resolve('sap')).toThrow(NotFoundException);
  });
});

describe('ExampleConnector', () => {
  const c = new ExampleConnector();
  const ctx = { integrationId: 'int-1' };

  it('implements all sync methods returning a SyncResult shape', async () => {
    for (const m of ['syncCustomers', 'syncProducts', 'syncInventory', 'syncPrices'] as const) {
      await expect(c[m](ctx)).resolves.toEqual({ processed: 0, failed: 0 });
    }
  });

  it('implements order methods returning ok', async () => {
    await expect(c.createOrder({})).resolves.toEqual({ ok: true });
    await expect(c.cancelOrder('r')).resolves.toEqual({ ok: true });
    await expect(c.updateOrder({})).resolves.toEqual({ ok: true });
  });
});
