import { Repository } from 'typeorm';
import { MappingService } from './mapping.service';

function repoMock() {
  return {
    findOne: jest.fn(),
    create: jest.fn((x) => x),
    save: jest.fn(async (x) => x),
  } as unknown as jest.Mocked<Repository<never>>;
}

describe('MappingService', () => {
  function make() {
    const customer = repoMock();
    const product = repoMock();
    const order = repoMock();
    const inventory = repoMock();
    const supplier = repoMock();
    const svc = new MappingService(
      customer as never,
      product as never,
      order as never,
      inventory as never,
      supplier as never,
    );
    return { svc, customer, product, order, inventory, supplier };
  }

  it('toPlatformId queries the correct table by entityType', async () => {
    const { svc, customer } = make();
    (customer.findOne as jest.Mock).mockResolvedValue({ platformId: 'uuid-1' });
    const id = await svc.toPlatformId('int-1', 'customer', 'ERP-999');
    expect(customer.findOne).toHaveBeenCalledWith({
      where: { integrationId: 'int-1', externalId: 'ERP-999' },
    });
    expect(id).toBe('uuid-1');
  });

  it('toExternalId resolves the reverse direction', async () => {
    const { svc, product } = make();
    (product.findOne as jest.Mock).mockResolvedValue({ externalId: 'SKU-1' });
    const ext = await svc.toExternalId('int-1', 'product', 'uuid-2');
    expect(product.findOne).toHaveBeenCalledWith({
      where: { integrationId: 'int-1', platformId: 'uuid-2' },
    });
    expect(ext).toBe('SKU-1');
  });

  it('returns null when no mapping exists', async () => {
    const { svc, supplier } = make();
    (supplier.findOne as jest.Mock).mockResolvedValue(null);
    expect(await svc.toPlatformId('int-1', 'supplier', 'x')).toBeNull();
  });

  it('link persists on the matching table', async () => {
    const { svc, inventory } = make();
    await svc.link('int-1', 'inventory', 'uuid-3', 'EXT-3', { warehouse: 'W1' });
    expect(inventory.save).toHaveBeenCalledWith(
      expect.objectContaining({ integrationId: 'int-1', platformId: 'uuid-3', externalId: 'EXT-3' }),
    );
  });

  it('link updates the existing row instead of inserting a duplicate when (integrationId, platformId) already has a mapping', async () => {
    // Regression: a blind insert here violates the CustomerMapping unique
    // constraint on (integrationId, platformId) the second time a returning
    // customer's upsert re-links the same platform customer to the ERP.
    const { svc, customer } = make();
    const row = {
      id: 'row-1', integrationId: 'int-1', platformId: 'uuid-1', externalId: 'OLD-CODE', externalRef: null,
    };
    (customer.findOne as jest.Mock).mockImplementation(async ({ where }) =>
      where.platformId === 'uuid-1' || where.externalId === 'OLD-CODE' ? row : null,
    );
    await svc.link('int-1', 'customer', 'uuid-1', 'NEW-CODE');
    expect(customer.findOne).toHaveBeenCalledWith({ where: { integrationId: 'int-1', platformId: 'uuid-1' } });
    expect(customer.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'row-1', integrationId: 'int-1', platformId: 'uuid-1', externalId: 'NEW-CODE' }),
    );
  });

  it('link skips the insert (no write, no throw) when the externalId is already mapped to a DIFFERENT platform entity', async () => {
    // (integrationId, externalId) is ALSO unique on every mapping table.
    // Repointing the external ID to a new platform entity would be an
    // auto-merge — forbidden: identity resolution is deterministic only,
    // conflicts must surface for humans. So: warn, no save, no throw.
    const { svc, customer } = make();
    const otherRow = {
      id: 'row-other', integrationId: 'int-1', platformId: 'uuid-OTHER', externalId: 'ERP-1', externalRef: null,
    };
    (customer.findOne as jest.Mock).mockImplementation(async ({ where }) =>
      where.externalId === 'ERP-1' ? otherRow : null,
    );
    await expect(svc.link('int-1', 'customer', 'uuid-NEW', 'ERP-1')).resolves.toBeUndefined();
    expect(customer.save).not.toHaveBeenCalled();
  });

  it('link skips the update (no write, no throw) when the new externalId belongs to another row', async () => {
    // Update-path twin of the conflict above: uuid-1 is mapped to OLD-CODE,
    // but TAKEN-CODE is owned by a different platform entity. Overwriting
    // would violate the (integrationId, externalId) unique constraint (500)
    // or silently steal the code. Leave both rows untouched.
    const { svc, customer } = make();
    const ownRow = {
      id: 'row-1', integrationId: 'int-1', platformId: 'uuid-1', externalId: 'OLD-CODE', externalRef: null,
    };
    const takenRow = {
      id: 'row-2', integrationId: 'int-1', platformId: 'uuid-2', externalId: 'TAKEN-CODE', externalRef: null,
    };
    (customer.findOne as jest.Mock).mockImplementation(async ({ where }) => {
      if (where.platformId === 'uuid-1') return ownRow;
      if (where.externalId === 'TAKEN-CODE') return takenRow;
      return null;
    });
    await expect(svc.link('int-1', 'customer', 'uuid-1', 'TAKEN-CODE')).resolves.toBeUndefined();
    expect(customer.save).not.toHaveBeenCalled();
  });
});
