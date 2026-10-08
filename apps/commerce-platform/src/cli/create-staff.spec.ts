// create-staff runs main() on import; the data source is faked so nothing touches a database.
const mockCalls: string[] = [];
const mockTokens = {
  update: jest.fn(async (where: unknown, changes: unknown) => { mockCalls.push(`update ${JSON.stringify(changes)}`); void where; return { affected: 1 }; }),
  manager: {
    transaction: jest.fn(async (work: (m: unknown) => Promise<unknown>) => work({
      query: jest.fn(async (sql: string, params: unknown[]) => { mockCalls.push(`${sql} ${JSON.stringify(params)}`); }),
      getRepository: () => mockTokens,
    })),
  },
};
const mockUsers = {
  findOne: jest.fn(async () => ({ id: 'u-1', email: 'rep@jagota.test', role: 'cs', status: 'active' })),
  create: (u: object) => u,
  save: jest.fn(async (u: object) => { mockCalls.push('save user'); return u; }),
};
let mockDone!: () => void;
const mockFinished = new Promise<void>((r) => { mockDone = r; });
jest.mock('../data-source', () => ({
  AppDataSource: {
    initialize: jest.fn(async () => undefined),
    destroy: jest.fn(async () => { mockDone(); }),
    getRepository: (entity: { name: string }) => (entity.name === 'AuthRefreshToken' ? mockTokens : mockUsers),
  },
}));

it('updating an existing account revokes its sign-ins through revokeAllForUser — under the per-account lock', async () => {
  const saved = { argv: process.argv, password: process.env.STAFF_PASSWORD };
  process.argv = ['node', 'create-staff', 'rep@jagota.test', 'cs'];
  process.env.STAFF_PASSWORD = 'spec-only-password';
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  try {
    await jest.isolateModulesAsync(async () => { await import('./create-staff'); });
    await mockFinished;
  } finally {
    process.argv = saved.argv;
    if (saved.password === undefined) delete process.env.STAFF_PASSWORD; else process.env.STAFF_PASSWORD = saved.password;
  }
  expect(mockTokens.manager.transaction).toHaveBeenCalledTimes(1);
  expect(mockCalls[0]).toBe('save user'); // the account changes first, the revoke second
  expect(mockCalls[1]).toContain('pg_advisory_xact_lock');
  expect(mockCalls[1]).toContain('"u-1"');
  expect(mockCalls[2]).toMatch(/^update .*"revokedReason":"cli"/);
  const [where] = mockTokens.update.mock.calls[0] as unknown as [Record<string, unknown>];
  expect(where.userId).toBe('u-1');
  expect(where.revokedAt).toMatchObject({ type: 'isNull' }); // only still-live tokens (isolated module copy of IsNull())
});
