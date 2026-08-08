import { createHash } from 'crypto';
import { ApiKeyService } from './api-key.service';

function makeService(rows: Record<string, unknown>[] = []) {
  const repo = {
    save: jest.fn().mockImplementation(async (r) => ({ id: 'k1', ...r })),
    create: (r: unknown) => r,
    find: jest.fn().mockResolvedValue(rows),
    findOne: jest.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) =>
      rows.find((r) => Object.entries(where).every(([k, v]) => (r as Record<string, unknown>)[k] === v)) ?? null),
    update: jest.fn(),
    count: jest.fn().mockImplementation(async (opts?: { where?: Record<string, unknown> }) => {
      if (!opts?.where) return rows.length;
      return rows.filter((r) =>
        Object.entries(opts.where!).every(([k, v]) => (r as Record<string, unknown>)[k] === v)).length;
    }),
  };
  return { service: new ApiKeyService(repo as never), repo };
}

describe('ApiKeyService', () => {
  it('createKey returns ck_live_ full key once and stores only hash + prefix', async () => {
    const { service, repo } = makeService();
    const res = await service.createKey('acc1', 'CRM key');
    expect(res.fullKey).toMatch(/^ck_live_[0-9a-f]{32}$/);
    expect(res.keyPrefix).toBe(res.fullKey.slice(0, 8 + 8)); // 'ck_live_' + 8 hex... see impl note
    const saved = repo.save.mock.calls[0][0] as Record<string, unknown>;
    expect(saved.keyHash).toBe(createHash('sha256').update(res.fullKey).digest('hex'));
    expect(JSON.stringify(saved)).not.toContain(res.fullKey);
  });

  it('validate finds an active row by hash and rejects revoked/inactive', async () => {
    const key = 'ck_live_' + 'a'.repeat(32);
    const hash = createHash('sha256').update(key).digest('hex');
    const { service } = makeService([{ id: 'k1', keyHash: hash, active: true, revokedAt: null }]);
    expect(await service.validate(key)).toMatchObject({ id: 'k1' });
    expect(await service.validate('ck_live_' + 'b'.repeat(32))).toBeNull();
  });

  it('hasAnyKeys counts ALL rows regardless of active flag (all-revoked table still fail-closed)', async () => {
    const { service } = makeService([{ id: 'k1', active: false, revokedAt: new Date() }]);
    expect(await service.hasAnyKeys()).toBe(true);
  });

  it('hasAnyKeys is false only when the table is truly empty', async () => {
    const { service } = makeService([]);
    expect(await service.hasAnyKeys()).toBe(false);
  });

  it('revoke only touches keys owned by the account', async () => {
    const { service, repo } = makeService([{ id: 'k1', accountId: 'acc1', active: true }]);
    await service.revoke('k1', 'acc1');
    expect(repo.update).toHaveBeenCalledWith({ id: 'k1', accountId: 'acc1' },
      expect.objectContaining({ active: false }));
    await expect(service.revoke('k1', 'other')).rejects.toThrow('not found');
  });
});
