import { BadRequestException } from '@nestjs/common';
import { JoshPromotions } from './josh-promotions';
import { JoshPromotionsController } from './josh-promotions.controller';

describe('JoshPromotions', () => {
  const ID = '11111111-1111-4111-8111-111111111111';
  const req = { staff: { userId: 'staff-1', email: 'mkt@jagota.co.th' } } as never;

  it('shadow: share of promotion lines where commerce picked josh\'s mechanic', async () => {
    const db = { query: jest.fn(async () => [{ lines: 8, same_mechanic: 7, matched: 6 }]) };
    const p = new JoshPromotions({ configured: true } as never, db as never);
    expect(await p.shadow(7)).toEqual({ days: 7, lines: 8, same_mechanic: 7, matched: 6, sameMechanicRate: 87.5 });
  });

  it('controller: writes go to josh as promotions actions with only the payload object', async () => {
    const josh = { run: jest.fn(async () => ({})) };
    const c = new JoshPromotionsController({ available: true } as never, josh as never);
    await c.create({ mechanic: { name: 'x' } }, req);
    await c.update(ID, { changes: ['bad'] }, req);
    await c.remove(ID, req);
    expect(josh.run.mock.calls.map((call) => (call as unknown[]).slice(0, 3))).toEqual([
      ['promotions', 'create', { mechanic: { name: 'x' } }],
      ['promotions', 'update', { id: ID, changes: {} }],
      ['promotions', 'remove', { id: ID }],
    ]);
    expect(() => c.list('nope')).toThrow(BadRequestException);
  });
});
