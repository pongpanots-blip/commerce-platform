import { WinbackStaffIdentityService } from './winback-staff-identity.service';

it('resolves both directions and caches links for at most 60s', async () => {
  let now = 1000;
  const clock = jest.spyOn(Date, 'now').mockImplementation(() => now);
  const db = { query: jest.fn().mockResolvedValue([{ josh_user_id: 'josh', commerce_user_id: 'commerce' }]) };
  const svc = new WinbackStaffIdentityService(db as never);
  try {
    expect(await svc.resolve('commerce', ' COMMERCE ')).toEqual({ id: 'commerce', joshId: 'josh' });
    expect(await svc.resolve('josh', 'JOSH')).toEqual({ id: 'commerce', joshId: 'josh' });
    await svc.resolve('josh', 'josh');
    expect(db.query).toHaveBeenCalledTimes(2);
    now += 60_000;
    db.query.mockResolvedValue([]);
    expect(await svc.resolve('josh', 'josh')).toEqual({ id: 'josh', joshId: 'josh' });
    expect(db.query).toHaveBeenCalledTimes(3);
  } finally { clock.mockRestore(); }
});
it('preserves unlinked identities and caches misses', async () => {
  const db = { query: jest.fn().mockResolvedValue([]) };
  const svc = new WinbackStaffIdentityService(db as never);
  expect(await svc.resolve('commerce', 'commerce')).toEqual({ id: 'commerce' });
  expect(await svc.resolve('josh', 'josh')).toEqual({ id: 'josh', joshId: 'josh' });
  await svc.resolve('commerce', 'commerce');
  expect(db.query).toHaveBeenCalledTimes(2);
});
