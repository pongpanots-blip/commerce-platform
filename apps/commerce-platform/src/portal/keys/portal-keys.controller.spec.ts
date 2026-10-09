import { ForbiddenException } from '@nestjs/common';
import { PortalKeysController } from './portal-keys.controller';
import { ApiKeyService } from '../../modules/core/api-key/application/api-key.service';

describe('PortalKeysController key-mint approval (PORTAL_KEY_MINT_ACCOUNT_IDS)', () => {
  const ACCOUNT = '11111111-1111-4111-8111-111111111111';
  const req = { portalAccount: { accountId: ACCOUNT } };
  let keys: { createKey: jest.Mock; listForAccount: jest.Mock; revoke: jest.Mock };
  let controller: PortalKeysController;
  const saved = process.env.PORTAL_KEY_MINT_ACCOUNT_IDS;

  beforeEach(() => {
    keys = {
      createKey: jest.fn().mockResolvedValue({ id: 'k1', fullKey: 'ck_live_x' }),
      listForAccount: jest.fn().mockResolvedValue([]),
      revoke: jest.fn().mockResolvedValue(undefined),
    };
    controller = new PortalKeysController(keys as unknown as ApiKeyService);
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.PORTAL_KEY_MINT_ACCOUNT_IDS;
    else process.env.PORTAL_KEY_MINT_ACCOUNT_IDS = saved;
  });

  it('unset: create is 403 and no key row is written', async () => {
    delete process.env.PORTAL_KEY_MINT_ACCOUNT_IDS;
    expect(() => controller.create(req, { name: 'k' })).toThrow(ForbiddenException);
    expect(keys.createKey).not.toHaveBeenCalled();
  });

  it('another account listed: still 403', () => {
    process.env.PORTAL_KEY_MINT_ACCOUNT_IDS = '22222222-2222-4222-8222-222222222222';
    expect(() => controller.create(req, { name: 'k' })).toThrow(ForbiddenException);
    expect(keys.createKey).not.toHaveBeenCalled();
  });

  it('approved account (case/space-insensitive list): creates the key', async () => {
    process.env.PORTAL_KEY_MINT_ACCOUNT_IDS = ` other , ${ACCOUNT.toUpperCase()} `;
    await expect(controller.create(req, { name: 'k' })).resolves.toMatchObject({ id: 'k1' });
    expect(keys.createKey).toHaveBeenCalledWith(ACCOUNT, 'k');
  });

  it('"*" approves any account (dev/e2e)', async () => {
    process.env.PORTAL_KEY_MINT_ACCOUNT_IDS = '*';
    await expect(controller.create(req, { name: 'k' })).resolves.toMatchObject({ id: 'k1' });
  });

  it('list and revoke are not gated', async () => {
    delete process.env.PORTAL_KEY_MINT_ACCOUNT_IDS;
    await controller.list(req);
    await controller.revoke(req, 'k1');
    expect(keys.listForAccount).toHaveBeenCalledWith(ACCOUNT);
    expect(keys.revoke).toHaveBeenCalledWith('k1', ACCOUNT);
  });
});
