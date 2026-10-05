import { UnauthorizedException } from '@nestjs/common';
import { AccountingRelayController, CreditBackSecretGuard, CreditNoteSecretGuard } from './accounting-relay.controller';

const ctx = (headers: Record<string, string>) => ({ switchToHttp: () => ({ getRequest: () => ({ headers }) }) }) as never;

describe('AccountingRelayController', () => {
  const OLD = process.env;
  beforeEach(() => { process.env = { ...OLD, CREDIT_NOTE_INGEST_SECRET: 'cn-secret', CREDIT_BACK_INGEST_SECRET: 'cb-secret' }; });
  afterAll(() => { process.env = OLD; });

  it('guards use josh\'s headers and secrets, fail closed when unset', () => {
    expect(new CreditNoteSecretGuard().canActivate(ctx({ 'x-credit-note-secret': 'cn-secret' }))).toBe(true);
    expect(() => new CreditNoteSecretGuard().canActivate(ctx({ 'x-credit-note-secret': 'cb-secret' }))).toThrow(UnauthorizedException);
    expect(new CreditBackSecretGuard().canActivate(ctx({ 'x-credit-back-secret': 'cb-secret' }))).toBe(true);
    delete process.env.CREDIT_BACK_INGEST_SECRET;
    expect(() => new CreditBackSecretGuard().canActivate(ctx({ 'x-credit-back-secret': '' }))).toThrow(UnauthorizedException);
  });

  it('relays verbatim as accounting events; ?lang rides in the body', async () => {
    const relay = { relay: jest.fn(async () => undefined) };
    const c = new AccountingRelayController(relay as never);
    expect(await c.creditNote({ cnNumber: 'CN1', orderNumber: 'SO1' })).toEqual({ received: true });
    await c.creditBack({ invoiceNumber: 'IV1' }, 'en');
    expect(relay.relay.mock.calls).toEqual([
      ['erp.credit_note.claim_approved', 'POST /credit-notes/claim-approved', { cnNumber: 'CN1', orderNumber: 'SO1' }],
      ['erp.credit_back.invoice_received', 'POST /credit-backs/invoice-received', { invoiceNumber: 'IV1', lang: 'en' }],
    ]);
  });
});
