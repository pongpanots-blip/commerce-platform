import { randomBytes } from 'node:crypto';
import { WebhookSecretsService } from './webhook-secrets.service';

function setup() {
  const rows: Record<string, unknown>[] = [];
  const repo = {
    save: jest.fn(async (r: Record<string, unknown>) => { const row = { id: 'id1', createdAt: new Date(), updatedAt: new Date(), ...r }; rows.push(row); return row; }),
    find: jest.fn(async () => rows), findBy: jest.fn(async () => rows), findOneBy: jest.fn(async () => rows[0] ?? null), delete: jest.fn(),
  };
  return { svc: new WebhookSecretsService(repo as never), repo, rows };
}

describe('WebhookSecretsService', () => {
  beforeEach(() => { process.env.MARKETING_WEBHOOK_SECRETS_KEY = randomBytes(32).toString('base64'); });
  afterEach(() => { delete process.env.MARKETING_WEBHOOK_SECRETS_KEY; });

  it('stores only ciphertext and never returns the value', async () => {
    const { svc, rows } = setup();
    const item = await svc.create('Partner token', 'Bearer s3cr3t', 'staff@x');
    expect(JSON.stringify(item)).not.toContain('s3cr3t');
    expect(JSON.stringify(rows)).not.toContain('s3cr3t');
    expect(JSON.stringify(await svc.list())).not.toContain('s3cr3t');
    expect((await svc.resolve(['id1'])).get('id1')).toBe('Bearer s3cr3t');
  });
  it('refuses to store without the key', async () => {
    delete process.env.MARKETING_WEBHOOK_SECRETS_KEY;
    await expect(setup().svc.create('x', 'y', 'a')).rejects.toThrow('MARKETING_WEBHOOK_SECRETS_KEY');
  });
});
