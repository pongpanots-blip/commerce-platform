# Josh Refund Requests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new refund flow in josh. A customer reports a return (with photo evidence), or the system opens a weight-difference refund. The customer then picks credit or money back. If money back on a KBank card, they get a void or refund. Any other paid method gets a bank transfer, for which they enter bank details, a bookbank photo, a cash reason and accept a policy. An admin approves in commerce-admin, and the system or finance pays out.

**Architecture:** There is a new `refund-requests` module in josh `apps/backend`, with its own tables (`refund_requests`, `refund_request_items`, `refund_bank_accounts`). It does **not** touch or reuse the old `order_refunds` / `cs-crm-claims` / `cs-admin` refund flow. Payout reuses josh tools that already exist:
- `CreditNoteService` (a new extracted `issueCreditNote`) for return → credit.
- `CreditBack` rows for weight diff. They are held, then activated or paid out.
- `KbankApiClient` (new `voidCharge` / `refundCharge` methods plus typed errors).
- `MediaStorageService` private uploads.

Money logic sits in pure helpers with table tests. The admin UI is a commerce-admin page that calls josh through the existing `/api/josh/admin-call` relay.

**Tech Stack:**
- josh: NestJS 10, TypeORM (raw-SQL migrations), Postgres, Jest (`npx nx test backend -- <spec>`).
- commerce-platform: NestJS + Jest. commerce-admin: React + Vitest.

**Spec:**
- `docs/research/2026-10-10-josh-refund-flow-edge-cases.md` (this repo).
- The decisions in the "Decisions" section below supersede §4 of that doc.

## Repos and branches

| Repo | Path | Branch |
|---|---|---|
| josh (jagota/Webjosh) | `~/Documents/dev/josh` — the main checkout is on an unrelated branch. Create a worktree: `git -C ~/Documents/dev/josh worktree add ../josh-worktrees/refund-requests -b feat/refund-requests origin/main` | `feat/refund-requests` |
| commerce-platform | this worktree | `claude/refund-flow-options-a85046` |

Tasks 1–12 run in the josh worktree. Tasks 13–14 run in this repo. All josh paths below are relative to `apps/backend/src/` unless they start with `apps/` or `docs/`.

## Decisions (confirmed with the user, 2026-10-10)

1. **Sources.**
   - **Return:** the customer reports it in the app (API now; the shop-web UI comes later). Admin can also create one.
   - **Weight diff:** opened automatically from a held CreditBack.
   - **Paid-order cancellation:** out of scope for this plan (today no money moves on cancel either).
2. **Every payout needs an admin click** after the admin checks the evidence. This applies to both returns and weight diff.
3. **Weight diff deadline:** if the customer has not chosen a method within 7 days, the system sets the method to credit and the request still waits for admin approval. If the amount is < 100 THB inc VAT, only credit is offered.
4. **Cash cap:** cash back ≤ the cash actually paid for the order minus cash already refunded. For a return, anything above that is issued as a Credit Note.
5. **Coupons:** refund the line price × qty (`order_items.product_price`, inc VAT). The coupon counts as used and is not given back. The cap is the total the customer handed over (cash + credit used on the order).
6. **Bank details.** The account holder name is checked manually by finance. The SLA text comes from the policy (30–45 business days).
7. **ERP credit note:** out of scope.
8. **shop-web UI:** not now. The mobile app is out of scope too; we deliver its API.
9. **Access:** only `admin` sees bank details and bookbank images in commerce-admin.

**Credit by source:**
- Return → **Credit Note** (`credit_notes`, usable at cart).
- Weight diff → the existing **CreditBack** (`credit_backs`), flipped from `held` to `active`.

**Card vs bank:**
- Card: order paid by KBank card (`payment_transactions.gateway_provider='kbank'`, `gateway_charge_id` starts with `chrg_`). Full charge with no earlier refund → **void**. Otherwise → **refund** (`amount`).
- If void is rejected by KBank (for example, already settled) → refund the full amount.
- Card older than 366 days → bank transfer.
- Jagota QR / COD / other paid methods → bank transfer.
- Credit terms (`gateway_provider='credit_terms'`) → credit only.

## Global Constraints

- **josh changes must be additive and default-off.** A new env flag `REFUND_FLOW_ENABLED` (`=== 'true'`) gates the weight-diff hold and the cron. With the flag off, CreditBack behaviour is byte-for-byte what it is today.
- **josh performance must not get worse.** No change to cart / checkout / order-list queries. `held` / `paid_out` CreditBacks are already excluded from cart because cart filters `cb_status = 'active'`.
- **Never call KBank from inside a DB transaction.** Record the intent and commit, then call KBank, then record the result in a second transaction.
- **KBank paths:**
  - Void: `POST /card/v2/charge/{charge_id}/Void` (capital **V**, as in `docs/kbank/api-reference/void-transaction-api.md`).
  - Refund: `POST /card/v2/charge/{charge_id}/refund` with body `{ reason, amount, transaction_date? }`. `transaction_date` is `YYYYMMDD`, required when the charge is older than 180 days. Refund is impossible after 366 days.
- **Money:** `numeric(12,2)`. Columns without an `_ex_vat` suffix are inc VAT. Use `roundMoney` (`shared/helpers/vat.helper.ts`) and `DEFAULT_VAT_RATE` (`shared/constants/checkout.constants.ts`, 0.07).
- **Migration timestamps** must be > `1792470000000` (the current max on origin/main). Raw SQL in `up`/`down`, `IF NOT EXISTS`, as in `migrations/1791130000000-CreateCreditBacks.ts`.
- **Customer API** uses camelCase JSON (per `docs/api-naming-glossary.md`) and the `{ status: true, statusCode, message, data }` envelope like `RefundsService.findOneForUser`. Error messages are in Thai, matching nearby code.
- **Bank account numbers** are stored only encrypted (AES-256-GCM, env `REFUND_PII_KEY`, 32 bytes base64). APIs return only `last4` to customers.
- **Uploads:**
  - Evidence and bookbank: jpg/jpeg/png, ≤ 10 MB each, evidence ≤ 5 files.
  - Transfer slip: jpg/jpeg/png/pdf ≤ 10 MB.
  - Stored with `MediaStorageService.uploadPrivateMulterFile`, shown with `getPrivateSignedUrl(key, 600)`.
- **Git:** keep commits local in both repos and push once at the end of the round. Never deploy, never push tags.

## Review Focus

1. **Network timeout during a KBank void/refund:** the request must end `gateway_status='unknown'` and stay `processing`. It must never auto-retry and never fall back from void to refund, because both could double-pay. Pinned in Task 9.
2. **ERP re-sends an invoice after a weight-diff cash payout:** `issueForShipment` must not reactivate the CreditBack (`paid_out` counts as used). Pinned in Task 6.
3. **Two admins click Approve together:** one wins and the other gets a 400 "สถานะเปลี่ยนไปแล้ว". KBank is called once. Pinned in Task 9.
4. **Two return reports for the same line at once:** the order row is locked, so the second sees the reduced remaining qty. The total qty can never exceed the ordered qty. Pinned in Task 7.
5. **A user who is not the orderer opens or acts on a refund or a bank account:** 404, with nothing leaked. Pinned in Task 7.

---

### Task 1: Schema — tables, entities, flag

**Files:**
- Create: `migrations/1792480000000-RefundRequests.ts`
- Create: `entities/refund-request.entity.ts`
- Create: `entities/refund-request-item.entity.ts`
- Create: `entities/refund-bank-account.entity.ts`
- Create: `app/refund-requests/refund-flow.flag.ts`
- Modify: `entities/typeorm-entities.ts` (import + add to `TYPEORM_ENTITIES`)
- Modify: `entities/credit-back.entity.ts` (doc comment on `cb_status`)
- Test: `app/refund-requests/refund-flow.flag.spec.ts`

**Interfaces:**
- Produces:
  - `RefundRequest`, `RefundRequestItem`, `RefundBankAccount` entities.
  - Enums `RefundRequestStatus`, `RefundRequestSource`, `RefundMethod`, `RefundCashReason`, `RefundGatewayStatus`, `RefundGatewayAction`.
  - `OPEN_REFUND_STATUSES`, `CASH_OUT_STATUSES`.
  - `isRefundFlowEnabled(): boolean`.

- [ ] **Step 1: Write the failing flag test**

```ts
// app/refund-requests/refund-flow.flag.spec.ts
import { isRefundFlowEnabled } from './refund-flow.flag';

describe('isRefundFlowEnabled', () => {
  const prev = process.env.REFUND_FLOW_ENABLED;
  afterEach(() => { process.env.REFUND_FLOW_ENABLED = prev; });

  it('is off unless exactly "true"', () => {
    delete process.env.REFUND_FLOW_ENABLED;
    expect(isRefundFlowEnabled()).toBe(false);
    process.env.REFUND_FLOW_ENABLED = 'TRUE';
    expect(isRefundFlowEnabled()).toBe(false);
    process.env.REFUND_FLOW_ENABLED = 'true';
    expect(isRefundFlowEnabled()).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx nx test backend -- apps/backend/src/app/refund-requests/refund-flow.flag.spec.ts`
Expected: FAIL, "Cannot find module './refund-flow.flag'".

- [ ] **Step 3: Write the flag**

```ts
// app/refund-requests/refund-flow.flag.ts
/**
 * New refund flow switch (default off). On: weight-diff Credit Backs are issued `held` and the
 * customer picks credit / money back through a refund request; off: Credit Backs go `active` as before.
 */
export function isRefundFlowEnabled(): boolean {
  return process.env.REFUND_FLOW_ENABLED === 'true';
}
```

- [ ] **Step 4: Write the migration**

```ts
// migrations/1792480000000-RefundRequests.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class RefundRequests1792480000000 implements MigrationInterface {
  name = 'RefundRequests1792480000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE SEQUENCE IF NOT EXISTS refund_request_number_seq`);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS refund_bank_accounts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NULL,
        user_id UUID NOT NULL,
        bank_code VARCHAR(10) NOT NULL,
        account_number_enc TEXT NOT NULL,
        account_last4 VARCHAR(4) NOT NULL,
        holder_name VARCHAR(150) NOT NULL,
        bookbank_key TEXT NOT NULL,
        saved BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        deleted_at TIMESTAMPTZ NULL
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_refund_bank_accounts_owner
        ON refund_bank_accounts (company_id, user_id) WHERE saved AND deleted_at IS NULL
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS refund_requests (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        refund_number VARCHAR(20) NOT NULL
          DEFAULT ('RF' || to_char(now(), 'YYYY') || lpad(nextval('refund_request_number_seq')::text, 6, '0')),
        order_id UUID NOT NULL REFERENCES orders(orders_id) ON DELETE RESTRICT,
        source VARCHAR(20) NOT NULL,
        status VARCHAR(30) NOT NULL,
        reason TEXT NOT NULL,
        amount_inc_vat NUMERIC(12,2) NOT NULL,
        credit_back_id UUID NULL REFERENCES credit_backs(cb_id) ON DELETE RESTRICT,
        requested_by_user_id UUID NULL,
        method VARCHAR(20) NULL,
        cash_reason VARCHAR(40) NULL,
        cash_reason_note TEXT NULL,
        bank_account_id UUID NULL REFERENCES refund_bank_accounts(id) ON DELETE RESTRICT,
        policy_version VARCHAR(20) NULL,
        policy_accepted_at TIMESTAMPTZ NULL,
        evidence_keys JSONB NOT NULL DEFAULT '[]'::jsonb,
        cash_amount_inc_vat NUMERIC(12,2) NULL,
        credit_amount_inc_vat NUMERIC(12,2) NULL,
        payment_transaction_id UUID NULL REFERENCES payment_transactions(id) ON DELETE RESTRICT,
        gateway_action VARCHAR(10) NULL,
        gateway_status VARCHAR(10) NULL,
        gateway_response JSONB NULL,
        credit_note_id UUID NULL REFERENCES credit_notes(cn_id) ON DELETE RESTRICT,
        transfer_slip_key TEXT NULL,
        transferred_amount NUMERIC(12,2) NULL,
        transferred_at TIMESTAMPTZ NULL,
        refund_to_label VARCHAR(80) NULL,
        changes_requested_reason TEXT NULL,
        reject_reason TEXT NULL,
        admin_note TEXT NULL,
        method_chosen_at TIMESTAMPTZ NULL,
        approved_at TIMESTAMPTZ NULL,
        approved_by VARCHAR(100) NULL,
        completed_at TIMESTAMPTZ NULL,
        rejected_at TIMESTAMPTZ NULL,
        cancelled_at TIMESTAMPTZ NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT uq_refund_requests_number UNIQUE (refund_number),
        CONSTRAINT chk_refund_requests_amount CHECK (amount_inc_vat > 0)
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_refund_requests_order ON refund_requests (order_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_refund_requests_status ON refund_requests (status, created_at)`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_refund_requests_credit_back
        ON refund_requests (credit_back_id) WHERE credit_back_id IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS refund_request_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        refund_request_id UUID NOT NULL REFERENCES refund_requests(id) ON DELETE CASCADE,
        order_item_id UUID NOT NULL REFERENCES order_items(id) ON DELETE RESTRICT,
        quantity INT NOT NULL CHECK (quantity > 0),
        amount_inc_vat NUMERIC(12,2) NOT NULL
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_refund_request_items_request ON refund_request_items (refund_request_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_refund_request_items_order_item ON refund_request_items (order_item_id)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS refund_request_items`);
    await queryRunner.query(`DROP TABLE IF EXISTS refund_requests`);
    await queryRunner.query(`DROP TABLE IF EXISTS refund_bank_accounts`);
    await queryRunner.query(`DROP SEQUENCE IF EXISTS refund_request_number_seq`);
  }
}
```

Check the FK target names against origin/main before running: `orders(orders_id)`, `order_items(id)`, `payment_transactions(id)`, `credit_notes(cn_id)`, `credit_backs(cb_id)`. Use `git grep -n "CREATE TABLE.*order_items" origin/main -- apps/backend/src/migrations`. If one differs, fix the FK. Never drop it.

- [ ] **Step 5: Write the entities**

```ts
// entities/refund-request.entity.ts
import {
  Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, OneToMany,
  PrimaryGeneratedColumn, UpdateDateColumn,
} from 'typeorm';
import { Order } from './order.entity';
import { RefundRequestItem } from './refund-request-item.entity';
import { RefundBankAccount } from './refund-bank-account.entity';

export enum RefundRequestStatus {
  AWAITING_METHOD = 'awaiting_method',
  UNDER_REVIEW = 'under_review',
  CHANGES_REQUESTED = 'changes_requested',
  PROCESSING = 'processing',
  AWAITING_TRANSFER = 'awaiting_transfer',
  COMPLETED = 'completed',
  REJECTED = 'rejected',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}
export enum RefundRequestSource { RETURN = 'return', WEIGHT_DIFF = 'weight_diff' }
export enum RefundMethod { CREDIT = 'credit', CARD = 'card', BANK_TRANSFER = 'bank_transfer' }
export enum RefundCashReason {
  BUSINESS_NEEDS_CASH = 'business_needs_cash',
  NO_REORDER_SOON = 'no_reorder_soon',
  ACCOUNTING_REQUIRES_BANK = 'accounting_requires_bank',
  PREFER_NOT_TO_SAY = 'prefer_not_to_say',
  OTHER = 'other',
}
export enum RefundGatewayStatus { PENDING = 'pending', SUCCESS = 'success', FAILED = 'failed', UNKNOWN = 'unknown' }
export enum RefundGatewayAction { VOID = 'void', REFUND = 'refund' }

/** Still waiting on the customer or the admin — weight-diff sync may update or cancel these. */
export const OPEN_REFUND_STATUSES: readonly RefundRequestStatus[] = [
  RefundRequestStatus.AWAITING_METHOD,
  RefundRequestStatus.UNDER_REVIEW,
  RefundRequestStatus.CHANGES_REQUESTED,
];
/** Cash is committed (in flight or paid) — counts against the order's cash cap. */
export const CASH_OUT_STATUSES: readonly RefundRequestStatus[] = [
  RefundRequestStatus.PROCESSING,
  RefundRequestStatus.AWAITING_TRANSFER,
  RefundRequestStatus.COMPLETED,
];

@Entity('refund_requests')
export class RefundRequest {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 20, insert: false, update: false }) refund_number: string;
  @Column({ type: 'uuid' }) order_id: string;
  @ManyToOne(() => Order, { onDelete: 'RESTRICT' }) @JoinColumn({ name: 'order_id' }) order: Order;
  @Column({ type: 'varchar', length: 20 }) source: RefundRequestSource;
  @Column({ type: 'varchar', length: 30 }) status: RefundRequestStatus;
  /** Return: the customer's text. Weight diff: the literal `weight_adjustment`. */
  @Column({ type: 'text' }) reason: string;
  @Column({ type: 'numeric', precision: 12, scale: 2 }) amount_inc_vat: number;
  @Column({ type: 'uuid', nullable: true }) credit_back_id: string | null;
  @Column({ type: 'uuid', nullable: true }) requested_by_user_id: string | null;
  @Column({ type: 'varchar', length: 20, nullable: true }) method: RefundMethod | null;
  @Column({ type: 'varchar', length: 40, nullable: true }) cash_reason: RefundCashReason | null;
  @Column({ type: 'text', nullable: true }) cash_reason_note: string | null;
  @Column({ type: 'uuid', nullable: true }) bank_account_id: string | null;
  @ManyToOne(() => RefundBankAccount, { nullable: true }) @JoinColumn({ name: 'bank_account_id' }) bankAccount: RefundBankAccount | null;
  @Column({ type: 'varchar', length: 20, nullable: true }) policy_version: string | null;
  @Column({ type: 'timestamp with time zone', nullable: true }) policy_accepted_at: Date | null;
  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" }) evidence_keys: string[];
  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true }) cash_amount_inc_vat: number | null;
  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true }) credit_amount_inc_vat: number | null;
  @Column({ type: 'uuid', nullable: true }) payment_transaction_id: string | null;
  @Column({ type: 'varchar', length: 10, nullable: true }) gateway_action: RefundGatewayAction | null;
  @Column({ type: 'varchar', length: 10, nullable: true }) gateway_status: RefundGatewayStatus | null;
  @Column({ type: 'jsonb', nullable: true }) gateway_response: Record<string, unknown> | null;
  @Column({ type: 'uuid', nullable: true }) credit_note_id: string | null;
  @Column({ type: 'text', nullable: true }) transfer_slip_key: string | null;
  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true }) transferred_amount: number | null;
  @Column({ type: 'timestamp with time zone', nullable: true }) transferred_at: Date | null;
  /** Figma "Refund to": `Visa *1234`, `Siam Commercial Bank *1234`, or the CN/CB number. */
  @Column({ type: 'varchar', length: 80, nullable: true }) refund_to_label: string | null;
  @Column({ type: 'text', nullable: true }) changes_requested_reason: string | null;
  @Column({ type: 'text', nullable: true }) reject_reason: string | null;
  @Column({ type: 'text', nullable: true }) admin_note: string | null;
  @Column({ type: 'timestamp with time zone', nullable: true }) method_chosen_at: Date | null;
  @Column({ type: 'timestamp with time zone', nullable: true }) approved_at: Date | null;
  @Column({ type: 'varchar', length: 100, nullable: true }) approved_by: string | null;
  @Column({ type: 'timestamp with time zone', nullable: true }) completed_at: Date | null;
  @Column({ type: 'timestamp with time zone', nullable: true }) rejected_at: Date | null;
  @Column({ type: 'timestamp with time zone', nullable: true }) cancelled_at: Date | null;
  @CreateDateColumn({ type: 'timestamp with time zone' }) created_at: Date;
  @UpdateDateColumn({ type: 'timestamp with time zone' }) updated_at: Date;
  @OneToMany(() => RefundRequestItem, (item) => item.refundRequest) items: RefundRequestItem[];
}
```

```ts
// entities/refund-request-item.entity.ts
import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { OrderItem } from './order-item.entity';
import { RefundRequest } from './refund-request.entity';

@Entity('refund_request_items')
export class RefundRequestItem {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) refund_request_id: string;
  @ManyToOne(() => RefundRequest, (r) => r.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'refund_request_id' }) refundRequest: RefundRequest;
  @Column({ type: 'uuid' }) order_item_id: string;
  @ManyToOne(() => OrderItem, { onDelete: 'RESTRICT' }) @JoinColumn({ name: 'order_item_id' }) orderItem: OrderItem;
  @Column({ type: 'int' }) quantity: number;
  /** product_price × quantity at report time (inc VAT) — coupon not prorated (decision 5). */
  @Column({ type: 'numeric', precision: 12, scale: 2 }) amount_inc_vat: number;
}
```

```ts
// entities/refund-bank-account.entity.ts
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** Bank details for a bank-transfer refund. `account_number_enc` = encryptPii(); never returned to customers. */
@Entity('refund_bank_accounts')
export class RefundBankAccount {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid', nullable: true }) company_id: string | null;
  @Column({ type: 'uuid' }) user_id: string;
  @Column({ type: 'varchar', length: 10 }) bank_code: string;
  @Column({ type: 'text' }) account_number_enc: string;
  @Column({ type: 'varchar', length: 4 }) account_last4: string;
  @Column({ type: 'varchar', length: 150 }) holder_name: string;
  @Column({ type: 'text' }) bookbank_key: string;
  /** "Save for future refunds" — only saved rows are listed back. */
  @Column({ type: 'boolean', default: false }) saved: boolean;
  @CreateDateColumn({ type: 'timestamp with time zone' }) created_at: Date;
  @Column({ type: 'timestamp with time zone', nullable: true }) deleted_at: Date | null;
}
```

In `entities/credit-back.entity.ts`, put this above `cb_status`:

```ts
  /**
   * active | exhausted | cancelled — plus, with REFUND_FLOW_ENABLED:
   * held (weight diff waiting for the customer's refund choice; not usable at cart) and
   * paid_out (paid back as money through a refund request; remaining 0, never reactivated).
   */
```

Register the three entities in `entities/typeorm-entities.ts`: add the imports, then add `RefundRequest, RefundRequestItem, RefundBankAccount` to the `TYPEORM_ENTITIES` array.

- [ ] **Step 6: Run the test and the migration up/down locally**

Run: `npx nx test backend -- apps/backend/src/app/refund-requests/refund-flow.flag.spec.ts` → PASS
Run: `npm run migration:run && npm run migration:revert && npm run migration:run` → all three succeed.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/migrations/1792480000000-RefundRequests.ts apps/backend/src/entities/refund-request*.ts apps/backend/src/entities/refund-bank-account.entity.ts apps/backend/src/entities/typeorm-entities.ts apps/backend/src/entities/credit-back.entity.ts apps/backend/src/app/refund-requests/refund-flow.flag*
git commit -m "feat(refund): refund request tables, entities and REFUND_FLOW_ENABLED flag"
```

---

### Task 2: Pure money and decision helpers

**Files:**
- Create: `app/refund-requests/refund-amount.helper.ts`
- Create: `app/refund-requests/refund-methods.helper.ts`
- Test: `app/refund-requests/refund-amount.helper.spec.ts`
- Test: `app/refund-requests/refund-methods.helper.spec.ts`

**Interfaces:**
- Consumes: `RefundMethod`, `RefundGatewayAction` (Task 1).
- Produces:
  - `toIncVat(exVat: number): number`, `toExVat(incVat: number): number`
  - `priceReturnLines(lines: OrderLineForReturn[], wanted: { orderItemId: string; quantity: number }[]): PricedReturnLine[]`
  - `capRefundAmount(i: { requestedIncVat: number; maxRefundableIncVat: number; alreadyRefundedIncVat: number }): number`
  - `splitCashCredit(i: { amountIncVat: number; cashPaidIncVat: number; cashAlreadyRefundedIncVat: number }): { cashIncVat: number; creditIncVat: number }`
  - `MIN_CASH_REFUND_INC_VAT = 100`
  - `type PaidCharge`
  - `availableMethods(i): RefundMethod[]`
  - `decideCardAction(i): RefundGatewayAction`
  - `kbankTransactionDate(paidAt: Date, now: Date): string | undefined`

- [ ] **Step 1: Write the failing tests**

```ts
// app/refund-requests/refund-amount.helper.spec.ts
import { BadRequestException } from '@nestjs/common';
import { capRefundAmount, priceReturnLines, splitCashCredit, toExVat, toIncVat } from './refund-amount.helper';

const line = (id: string, price: number, qty: number, already = 0) =>
  ({ id, productPrice: price, productQuantity: qty, alreadyRequested: already });

describe('priceReturnLines', () => {
  it('prices product_price × qty, coupon not prorated (decision 5: return a 300 item → 300)', () => {
    expect(priceReturnLines([line('a', 300, 1), line('b', 700, 1)], [{ orderItemId: 'a', quantity: 1 }]))
      .toEqual([{ orderItemId: 'a', quantity: 1, amountIncVat: 300 }]);
  });
  it('rejects qty above what is left after earlier requests', () => {
    expect(() => priceReturnLines([line('a', 10, 3, 2)], [{ orderItemId: 'a', quantity: 2 }]))
      .toThrow(BadRequestException);
  });
  it('rejects an item not on the order, and duplicate lines', () => {
    expect(() => priceReturnLines([line('a', 10, 3)], [{ orderItemId: 'x', quantity: 1 }])).toThrow(BadRequestException);
    expect(() => priceReturnLines([line('a', 10, 3)], [
      { orderItemId: 'a', quantity: 1 }, { orderItemId: 'a', quantity: 1 },
    ])).toThrow(BadRequestException);
  });
  it('rounds to satang', () => {
    expect(priceReturnLines([line('a', 33.335, 3)], [{ orderItemId: 'a', quantity: 3 }])[0].amountIncVat).toBe(100.01);
  });
});

describe('capRefundAmount', () => {
  it('caps a full return at what the customer handed over (paid 900 on a 1,000 order with a 100 coupon)', () => {
    expect(capRefundAmount({ requestedIncVat: 1000, maxRefundableIncVat: 900, alreadyRefundedIncVat: 0 })).toBe(900);
  });
  it('subtracts earlier refunds and never goes negative', () => {
    expect(capRefundAmount({ requestedIncVat: 300, maxRefundableIncVat: 900, alreadyRefundedIncVat: 800 })).toBe(100);
    expect(capRefundAmount({ requestedIncVat: 300, maxRefundableIncVat: 900, alreadyRefundedIncVat: 950 })).toBe(0);
  });
});

describe('splitCashCredit', () => {
  it('pays cash up to the cash left, rest becomes credit (decision 4)', () => {
    expect(splitCashCredit({ amountIncVat: 900, cashPaidIncVat: 700, cashAlreadyRefundedIncVat: 0 }))
      .toEqual({ cashIncVat: 700, creditIncVat: 200 });
    expect(splitCashCredit({ amountIncVat: 300, cashPaidIncVat: 700, cashAlreadyRefundedIncVat: 500 }))
      .toEqual({ cashIncVat: 200, creditIncVat: 100 });
    expect(splitCashCredit({ amountIncVat: 300, cashPaidIncVat: 700, cashAlreadyRefundedIncVat: 0 }))
      .toEqual({ cashIncVat: 300, creditIncVat: 0 });
  });
});

describe('VAT conversion', () => {
  it('uses 7%', () => {
    expect(toIncVat(100)).toBe(107);
    expect(toExVat(107)).toBe(100);
  });
});
```

```ts
// app/refund-requests/refund-methods.helper.spec.ts
import { RefundGatewayAction, RefundMethod } from '../../entities/refund-request.entity';
import { availableMethods, decideCardAction, kbankTransactionDate, PaidCharge } from './refund-methods.helper';

const now = new Date('2026-10-10T00:00:00Z');
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);
const kbankCard = (over: Partial<PaidCharge> = {}): PaidCharge => ({
  id: 't1', gatewayChargeId: 'chrg_prod_1', gatewayProvider: 'kbank', paymentMethod: 'credit',
  chargeAmount: 1000, orderShare: 1000, paidAt: daysAgo(3), cardLast4: '1234', cardBrand: 'Visa', isTest: false, ...over,
});
const base = { amountIncVat: 500, cashRemainingIncVat: 1000, now, sandbox: false, allowSplit: true };

describe('availableMethods', () => {
  it('KBank card → credit + card', () => {
    expect(availableMethods({ ...base, charge: kbankCard() })).toEqual([RefundMethod.CREDIT, RefundMethod.CARD]);
  });
  it('Jagota QR, COD or no charge → credit + bank transfer', () => {
    expect(availableMethods({ ...base, charge: kbankCard({ gatewayProvider: 'jagota', gatewayChargeId: 'J1', paymentMethod: 'qr' }) }))
      .toEqual([RefundMethod.CREDIT, RefundMethod.BANK_TRANSFER]);
    expect(availableMethods({ ...base, charge: null })).toEqual([RefundMethod.CREDIT, RefundMethod.BANK_TRANSFER]);
  });
  it('credit terms → credit only', () => {
    expect(availableMethods({ ...base, charge: kbankCard({ gatewayProvider: 'credit_terms', gatewayChargeId: null }) }))
      .toEqual([RefundMethod.CREDIT]);
  });
  it('under 100 THB → credit only', () => {
    expect(availableMethods({ ...base, amountIncVat: 99.99, charge: kbankCard() })).toEqual([RefundMethod.CREDIT]);
  });
  it('card older than 366 days → bank transfer instead of card', () => {
    expect(availableMethods({ ...base, charge: kbankCard({ paidAt: daysAgo(367) }) }))
      .toEqual([RefundMethod.CREDIT, RefundMethod.BANK_TRANSFER]);
  });
  it('test charge outside sandbox (and the reverse) is never refunded to card', () => {
    expect(availableMethods({ ...base, charge: kbankCard({ isTest: true }) }))
      .toEqual([RefundMethod.CREDIT, RefundMethod.BANK_TRANSFER]);
    expect(availableMethods({ ...base, sandbox: true, charge: kbankCard({ isTest: true }) }))
      .toEqual([RefundMethod.CREDIT, RefundMethod.CARD]);
  });
  it('weight diff (no split) above the cash left → credit only; no cash left at all → credit only', () => {
    expect(availableMethods({ ...base, allowSplit: false, cashRemainingIncVat: 400, charge: kbankCard() })).toEqual([RefundMethod.CREDIT]);
    expect(availableMethods({ ...base, cashRemainingIncVat: 0, charge: kbankCard() })).toEqual([RefundMethod.CREDIT]);
  });
});

describe('decideCardAction', () => {
  it('void only for the full charge with no earlier refund', () => {
    expect(decideCardAction({ chargeAmount: 1000, refundAmount: 1000, refundedBeforeOnCharge: 0 })).toBe(RefundGatewayAction.VOID);
    expect(decideCardAction({ chargeAmount: 1000, refundAmount: 999.99, refundedBeforeOnCharge: 0 })).toBe(RefundGatewayAction.REFUND);
    expect(decideCardAction({ chargeAmount: 1000, refundAmount: 500, refundedBeforeOnCharge: 500 })).toBe(RefundGatewayAction.REFUND);
  });
  it('a batch charge covering several orders is never "full" for one order', () => {
    expect(decideCardAction({ chargeAmount: 3000, refundAmount: 1000, refundedBeforeOnCharge: 0 })).toBe(RefundGatewayAction.REFUND);
  });
});

describe('kbankTransactionDate', () => {
  it('only after 180 days, as YYYYMMDD (Bangkok date)', () => {
    expect(kbankTransactionDate(daysAgo(180), now)).toBeUndefined();
    expect(kbankTransactionDate(new Date('2026-03-01T20:00:00Z'), now)).toBe('20260302');
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx nx test backend -- apps/backend/src/app/refund-requests/refund-amount.helper.spec.ts apps/backend/src/app/refund-requests/refund-methods.helper.spec.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

```ts
// app/refund-requests/refund-amount.helper.ts
import { BadRequestException } from '@nestjs/common';
import { DEFAULT_VAT_RATE } from '../../shared/constants/checkout.constants';
import { roundMoney } from '../../shared/helpers/vat.helper';

export const toIncVat = (exVat: number): number => roundMoney(exVat * (1 + DEFAULT_VAT_RATE));
export const toExVat = (incVat: number): number => roundMoney(incVat / (1 + DEFAULT_VAT_RATE));

export type OrderLineForReturn = {
  id: string;
  /** order_items.product_price — inc VAT, after promotion, before coupon. */
  productPrice: number;
  productQuantity: number;
  /** qty already in refund requests that are not rejected / cancelled. */
  alreadyRequested: number;
};
export type PricedReturnLine = { orderItemId: string; quantity: number; amountIncVat: number };

export function priceReturnLines(
  lines: OrderLineForReturn[],
  wanted: { orderItemId: string; quantity: number }[],
): PricedReturnLine[] {
  const byId = new Map(lines.map((l) => [l.id, l]));
  const seen = new Set<string>();
  return wanted.map((w) => {
    const line = byId.get(w.orderItemId);
    if (!line) throw new BadRequestException(`ไม่พบรายการสินค้า ${w.orderItemId} ในออเดอร์นี้`);
    if (seen.has(w.orderItemId)) throw new BadRequestException(`รายการสินค้า ${w.orderItemId} ซ้ำ`);
    seen.add(w.orderItemId);
    const left = line.productQuantity - line.alreadyRequested;
    if (!Number.isInteger(w.quantity) || w.quantity < 1 || w.quantity > left) {
      throw new BadRequestException(`จำนวนที่ขอคืน (${w.quantity}) เกินจำนวนที่ยังขอคืนได้ (${left})`);
    }
    return { orderItemId: w.orderItemId, quantity: w.quantity, amountIncVat: roundMoney(line.productPrice * w.quantity) };
  });
}

export function capRefundAmount(i: {
  requestedIncVat: number; maxRefundableIncVat: number; alreadyRefundedIncVat: number;
}): number {
  return Math.max(0, roundMoney(Math.min(i.requestedIncVat, i.maxRefundableIncVat - i.alreadyRefundedIncVat)));
}

export function splitCashCredit(i: {
  amountIncVat: number; cashPaidIncVat: number; cashAlreadyRefundedIncVat: number;
}): { cashIncVat: number; creditIncVat: number } {
  const cashLeft = Math.max(0, roundMoney(i.cashPaidIncVat - i.cashAlreadyRefundedIncVat));
  const cashIncVat = roundMoney(Math.min(i.amountIncVat, cashLeft));
  return { cashIncVat, creditIncVat: roundMoney(i.amountIncVat - cashIncVat) };
}
```

```ts
// app/refund-requests/refund-methods.helper.ts
import { RefundGatewayAction, RefundMethod } from '../../entities/refund-request.entity';

export const MIN_CASH_REFUND_INC_VAT = 100;
const DAY_MS = 86_400_000;

/** The order's latest `success` payment_transaction (direct or via payment_transaction_orders). */
export type PaidCharge = {
  id: string;
  gatewayChargeId: string | null;
  gatewayProvider: string;
  paymentMethod: string;
  /** Whole charge (payment_transactions.amount) — what void reverses. */
  chargeAmount: number;
  /** This order's share (allocated_amount for a batch, else amount) — the cash cap. */
  orderShare: number;
  paidAt: Date | null;
  cardLast4: string | null;
  cardBrand: string | null;
  isTest: boolean;
};

const isKbankCard = (c: PaidCharge) => c.gatewayProvider === 'kbank' && !!c.gatewayChargeId?.startsWith('chrg_');

export function availableMethods(i: {
  amountIncVat: number;
  charge: PaidCharge | null;
  /** cash paid for the order − cash already refunded. */
  cashRemainingIncVat: number;
  now: Date;
  sandbox: boolean;
  /** Return: excess over cash becomes a Credit Note. Weight diff: no split, so cash needs the whole amount. */
  allowSplit: boolean;
}): RefundMethod[] {
  const credit = [RefundMethod.CREDIT];
  if (i.amountIncVat < MIN_CASH_REFUND_INC_VAT) return credit;
  if (i.charge?.gatewayProvider === 'credit_terms') return credit;
  if (i.cashRemainingIncVat <= 0) return credit;
  if (!i.allowSplit && i.amountIncVat > i.cashRemainingIncVat) return credit;
  const c = i.charge;
  const cardOk =
    !!c && isKbankCard(c) && c.isTest === i.sandbox &&
    !!c.paidAt && i.now.getTime() - c.paidAt.getTime() <= 366 * DAY_MS;
  return [...credit, cardOk ? RefundMethod.CARD : RefundMethod.BANK_TRANSFER];
}

export function decideCardAction(i: {
  chargeAmount: number; refundAmount: number; refundedBeforeOnCharge: number;
}): RefundGatewayAction {
  const full = Math.abs(i.chargeAmount - i.refundAmount) < 0.005;
  return full && i.refundedBeforeOnCharge === 0 ? RefundGatewayAction.VOID : RefundGatewayAction.REFUND;
}

/** KBank wants `transaction_date` (YYYYMMDD, charge date) for refunds of charges older than 180 days. */
export function kbankTransactionDate(paidAt: Date, now: Date): string | undefined {
  if (now.getTime() - paidAt.getTime() <= 180 * DAY_MS) return undefined;
  const bkk = new Date(paidAt.getTime() + 7 * 3_600_000);
  return bkk.toISOString().slice(0, 10).replace(/-/g, '');
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/app/refund-requests/refund-amount.helper* apps/backend/src/app/refund-requests/refund-methods.helper*
git commit -m "feat(refund): pure helpers for refund amounts, caps, methods and void-vs-refund"
```

---

### Task 3: PII cipher, bank list, policy

**Files:**
- Create: `shared/helpers/pii-cipher.helper.ts`
- Create: `app/refund-requests/refund-banks.ts`
- Create: `app/refund-requests/refund-policy.ts`
- Test: `shared/helpers/pii-cipher.helper.spec.ts`
- Test: `app/refund-requests/refund-banks.spec.ts`

**Interfaces:**
- Produces:
  - `encryptPii(plain: string): string`, `decryptPii(stored: string): string`
  - `REFUND_BANKS: readonly RefundBank[]`, `findRefundBank(code: string): RefundBank | undefined`, `isValidAccountNumber(code: string, digits: string): boolean`
  - `BANK_TRANSFER_POLICY: { version: string; th: PolicyText; en: PolicyText }`

- [ ] **Step 1: Write the failing tests**

```ts
// shared/helpers/pii-cipher.helper.spec.ts
import { randomBytes } from 'crypto';
import { decryptPii, encryptPii } from './pii-cipher.helper';

describe('pii cipher', () => {
  const prev = process.env.REFUND_PII_KEY;
  beforeEach(() => { process.env.REFUND_PII_KEY = randomBytes(32).toString('base64'); });
  afterAll(() => { process.env.REFUND_PII_KEY = prev; });

  it('round-trips and never stores the plain text', () => {
    const enc = encryptPii('1234567890');
    expect(enc.startsWith('v1:')).toBe(true);
    expect(enc).not.toContain('1234567890');
    expect(decryptPii(enc)).toBe('1234567890');
  });
  it('gives a different ciphertext each time (random IV)', () => {
    expect(encryptPii('1234567890')).not.toBe(encryptPii('1234567890'));
  });
  it('fails on tampering', () => {
    const enc = encryptPii('1234567890');
    const parts = enc.split(':');
    parts[3] = Buffer.from('tampered!').toString('base64');
    expect(() => decryptPii(parts.join(':'))).toThrow();
  });
  it('fails closed without a 32-byte key', () => {
    delete process.env.REFUND_PII_KEY;
    expect(() => encryptPii('1')).toThrow('REFUND_PII_KEY');
    process.env.REFUND_PII_KEY = Buffer.from('short').toString('base64');
    expect(() => encryptPii('1')).toThrow('REFUND_PII_KEY');
  });
});
```

```ts
// app/refund-requests/refund-banks.spec.ts
import { findRefundBank, isValidAccountNumber, REFUND_BANKS } from './refund-banks';

describe('refund banks', () => {
  it('lists the 8 banks from Figma in order', () => {
    expect(REFUND_BANKS.map((b) => b.code)).toEqual(['SCB', 'KBANK', 'KTB', 'BBL', 'TTB', 'BAY', 'LHB', 'GSB']);
  });
  it('validates account digits per bank', () => {
    expect(isValidAccountNumber('SCB', '1234567890')).toBe(true);
    expect(isValidAccountNumber('SCB', '123456789')).toBe(false);
    expect(isValidAccountNumber('GSB', '123456789012')).toBe(true);
    expect(isValidAccountNumber('SCB', '12345abc90')).toBe(false);
    expect(isValidAccountNumber('NOPE', '1234567890')).toBe(false);
  });
  it('finds by code', () => {
    expect(findRefundBank('KBANK')?.nameEn).toBe('Kasikornbank');
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx nx test backend -- apps/backend/src/shared/helpers/pii-cipher.helper.spec.ts apps/backend/src/app/refund-requests/refund-banks.spec.ts` → FAIL.

- [ ] **Step 3: Implement**

```ts
// shared/helpers/pii-cipher.helper.ts
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/** AES-256-GCM for PII at rest (refund bank account numbers). Format: v1:<iv>:<tag>:<ciphertext>, base64 parts. */
function key(): Buffer {
  const raw = process.env.REFUND_PII_KEY?.trim();
  const buf = raw ? Buffer.from(raw, 'base64') : Buffer.alloc(0);
  if (buf.length !== 32) throw new Error('REFUND_PII_KEY must be 32 bytes, base64');
  return buf;
}

export function encryptPii(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), ct.toString('base64')].join(':');
}

export function decryptPii(stored: string): string {
  const [v, iv, tag, ct] = stored.split(':');
  if (v !== 'v1' || !iv || !tag || !ct) throw new Error('unknown PII cipher format');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64')), decipher.final()]).toString('utf8');
}
```

```ts
// app/refund-requests/refund-banks.ts
export type RefundBank = { code: string; nameEn: string; nameTh: string; digits: readonly number[] };

/** Figma "Select your bank" list, same order. `digits` = allowed account-number lengths. */
export const REFUND_BANKS: readonly RefundBank[] = [
  { code: 'SCB', nameEn: 'Siam Commercial Bank', nameTh: 'ธนาคารไทยพาณิชย์', digits: [10] },
  { code: 'KBANK', nameEn: 'Kasikornbank', nameTh: 'ธนาคารกสิกรไทย', digits: [10] },
  { code: 'KTB', nameEn: 'Krungthai Bank', nameTh: 'ธนาคารกรุงไทย', digits: [10] },
  { code: 'BBL', nameEn: 'Bangkok Bank', nameTh: 'ธนาคารกรุงเทพ', digits: [10] },
  { code: 'TTB', nameEn: 'TMBThanachart Bank', nameTh: 'ธนาคารทหารไทยธนชาต', digits: [10] },
  { code: 'BAY', nameEn: 'Bank of Ayudhya', nameTh: 'ธนาคารกรุงศรีอยุธยา', digits: [10] },
  { code: 'LHB', nameEn: 'LH Bank', nameTh: 'ธนาคารแลนด์ แอนด์ เฮ้าส์', digits: [10] },
  { code: 'GSB', nameEn: 'Government Savings Bank', nameTh: 'ธนาคารออมสิน', digits: [12, 15] },
];

export const findRefundBank = (code: string) => REFUND_BANKS.find((b) => b.code === code);

export function isValidAccountNumber(code: string, digits: string): boolean {
  const bank = findRefundBank(code);
  return !!bank && /^\d+$/.test(digits) && bank.digits.includes(digits.length);
}
```

```ts
// app/refund-requests/refund-policy.ts
export type PolicyText = { title: string; bullets: string[]; acceptLabel: string };

/**
 * Figma "Payment Partner Terms". Bump `version` whenever the text changes — refund requests store the
 * version the customer accepted. PAYMENT_PARTNER_NAME: business to confirm (Figma shows "[Payment Partner]").
 */
const PAYMENT_PARTNER_NAME = 'Jagota';

export const BANK_TRANSFER_POLICY: { version: string; th: PolicyText; en: PolicyText } = {
  version: '2026-10-v1',
  en: {
    title: 'Payment Partner Terms',
    bullets: [
      `Bank refunds are processed by ${PAYMENT_PARTNER_NAME}.`,
      'Transfers take 30–45 business days after review.',
      'The account holder name must match your registered business.',
      "Once the transfer is sent, it can't be cancelled or changed.",
    ],
    acceptLabel: "I've read and accept the payment partner terms.",
  },
  th: {
    title: 'เงื่อนไขการคืนเงินผ่านธนาคาร',
    bullets: [
      `การคืนเงินเข้าบัญชีธนาคารดำเนินการโดย ${PAYMENT_PARTNER_NAME}`,
      'ใช้เวลาโอน 30–45 วันทำการหลังตรวจสอบคำขอ',
      'ชื่อบัญชีต้องตรงกับชื่อธุรกิจที่ลงทะเบียนไว้',
      'เมื่อโอนเงินแล้วจะยกเลิกหรือแก้ไขไม่ได้',
    ],
    acceptLabel: 'ฉันได้อ่านและยอมรับเงื่อนไขการคืนเงิน',
  },
};
```

Add `REFUND_PII_KEY=` with the comment `# 32 bytes base64: openssl rand -base64 32` to `apps/backend/.env.example`, next to the other secrets.

- [ ] **Step 4: Run the tests to verify they pass** (command from Step 2) → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/shared/helpers/pii-cipher.helper* apps/backend/src/app/refund-requests/refund-banks* apps/backend/src/app/refund-requests/refund-policy.ts apps/backend/.env.example
git commit -m "feat(refund): PII cipher, bank list and bank-transfer policy text"
```

---

### Task 4: KBank client — typed errors, void and refund

**Files:**
- Modify: `app/payment/kbank/kbank-api.client.ts` (`request<T>` ~line 716–770; add methods next to `inquiryTransaction` ~line 493)
- Test: `app/payment/kbank/kbank-api.client.refund.spec.ts`

**Interfaces:**
- Produces:
  - `class KbankHttpError extends BadRequestException { httpStatus: number; code: string | null }`
  - `class KbankNetworkError extends BadRequestException`
  - `voidCharge(chargeId: string, reason: string): Promise<Record<string, unknown>>`
  - `refundCharge(i: { chargeId: string; amount: number; reason: string; transactionDate?: string }): Promise<Record<string, unknown>>`

Both error classes extend `BadRequestException`, so every existing `catch (BadRequestException)` behaves as before.

- [ ] **Step 1: Write the failing test** (copy the env setup from `kbank-api.client.spec.ts`: set `process.env.KBANK_*` in `beforeEach`, `global.fetch = jest.fn()`)

```ts
// app/payment/kbank/kbank-api.client.refund.spec.ts
import { KbankApiClient, KbankHttpError, KbankNetworkError } from './kbank-api.client';

const ok = (body: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });
const fail = (status: number, body: unknown) => ({ ok: false, status, text: async () => JSON.stringify(body) });

describe('KbankApiClient void / refund', () => {
  let client: KbankApiClient;
  beforeEach(() => {
    // same KBANK_* env as kbank-api.client.spec.ts beforeEach
    process.env.KBANK_API_BASE_URL = 'https://dev-kpaymentgateway-services.kasikornbank.com';
    process.env.KBANK_SECRET_KEY = 'skey_test_x';
    process.env.KBANK_PUBLIC_KEY = 'pkey_test_x';
    process.env.KBANK_MID = 'mid';
    global.fetch = jest.fn();
    client = new KbankApiClient();
  });

  it('voids with POST /card/v2/charge/{id}/Void and the reason', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(ok({ id: 'chrg_1', object: 'charge' }));
    await client.voidCharge('chrg_1', 'refund RF2026000001');
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toMatch(/\/card\/v2\/charge\/chrg_1\/Void$/);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ reason: 'refund RF2026000001' });
  });

  it('refunds with amount and optional transaction_date', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(ok({ id: 'chrg_1' }));
    await client.refundCharge({ chargeId: 'chrg_1', amount: 200.5, reason: 'r', transactionDate: '20260302' });
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toMatch(/\/card\/v2\/charge\/chrg_1\/refund$/);
    expect(JSON.parse(init.body)).toEqual({ reason: 'r', amount: 200.5, transaction_date: '20260302' });
  });

  it('non-2xx → KbankHttpError with status and gateway code', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(fail(400, { code: 'charge_already_settled', message: 'settled' }));
    const err = await client.voidCharge('chrg_1', 'r').catch((e) => e);
    expect(err).toBeInstanceOf(KbankHttpError);
    expect(err).toMatchObject({ httpStatus: 400, code: 'charge_already_settled', message: 'settled' });
  });

  it('network error → KbankNetworkError (outcome unknown)', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('ETIMEDOUT'));
    await expect(client.refundCharge({ chargeId: 'chrg_1', amount: 1, reason: 'r' })).rejects.toBeInstanceOf(KbankNetworkError);
  });
});
```

Copy the exact env variable names from `kbank-api.client.spec.ts`. The names above are illustrative only, so use whatever `resolveKbankConfig()` reads.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx nx test backend -- apps/backend/src/app/payment/kbank/kbank-api.client.refund.spec.ts` → FAIL ("KbankHttpError is not exported").

- [ ] **Step 3: Implement**

Add these near `KbankChargeNotFoundError` (~line 15):

```ts
/** KBank answered non-2xx — a definite "no" (e.g. void on a settled charge). */
export class KbankHttpError extends BadRequestException {
  constructor(readonly httpStatus: number, readonly code: string | null, message: string) {
    super(message);
    this.name = 'KbankHttpError';
  }
}

/** Request never got an answer — the outcome at KBank is UNKNOWN; never retry a money-out call blindly. */
export class KbankNetworkError extends BadRequestException {
  constructor() {
    super('เรียก KBank API ไม่สำเร็จ');
    this.name = 'KbankNetworkError';
  }
}
```

In `request<T>`:
- Replace `throw new BadRequestException('เรียก KBank API ไม่สำเร็จ');` with `throw new KbankNetworkError();`.
- Replace the final `throw new BadRequestException(message);` with:

```ts
      const code =
        typeof payload === 'object' && payload && typeof (payload as { code?: unknown }).code === 'string'
          ? (payload as { code: string }).code
          : null;
      throw new KbankHttpError(response.status, code, message);
```

Add the methods after `inquiryTransaction`:

```ts
  /** POST /card/v2/charge/{id}/Void — whole charge, before settlement only. */
  async voidCharge(chargeId: string, reason: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>('POST', `/card/v2/charge/${encodeURIComponent(chargeId)}/Void`, {
      reason: reason.slice(0, 256),
    });
  }

  /** POST /card/v2/charge/{id}/refund — partial or full; `transactionDate` (YYYYMMDD) for charges > 180 days old. */
  async refundCharge(input: {
    chargeId: string; amount: number; reason: string; transactionDate?: string;
  }): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>('POST', `/card/v2/charge/${encodeURIComponent(input.chargeId)}/refund`, {
      reason: input.reason.slice(0, 256),
      amount: input.amount,
      ...(input.transactionDate ? { transaction_date: input.transactionDate } : {}),
    });
  }
```

- [ ] **Step 4: Run the new spec and the existing KBank specs**

Run: `npx nx test backend -- apps/backend/src/app/payment/kbank` → all PASS (existing specs that expect `BadRequestException` still pass).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/app/payment/kbank/kbank-api.client.ts apps/backend/src/app/payment/kbank/kbank-api.client.refund.spec.ts
git commit -m "feat(kbank): void/refund charge calls and typed http/network errors"
```

---

### Task 5: Credit Note — extract `issueCreditNote`

**Files:**
- Modify: `app/credit-note/credit-note.service.ts` (`ingestClaimApproved` ~line 210–264, `notifyIssued` ~479)
- Test: `app/credit-note/credit-note.issue.spec.ts`

**Interfaces:**
- Produces:
  - `CreditNoteService.issueCreditNote(manager: EntityManager, input: { order: Order; amountExVat: number; reason: string; cnNumber: string }): Promise<CreditNote>`. It runs the cap check and inserts the row, without notifying.
  - `CreditNoteService.notifyIssued(order: Order, cn: CreditNote): Promise<void>`, now public. Call it after commit.

- [ ] **Step 1: Write the failing test** (follow `credit-note.notify.spec.ts` for how the service is built: `Object.create(CreditNoteService.prototype)` plus assigned repos)

```ts
// app/credit-note/credit-note.issue.spec.ts
import { BadRequestException } from '@nestjs/common';
import { CreditNoteService } from './credit-note.service';
import { CreditNote } from '../../entities/credit-note.entity';

const order = { orders_id: 'o1', status: 'delivered', gross_ex_vat: 1000, subtotal_ex_vat: 1000, total_price: 1070 } as never;

function managerWith(existing: Partial<CreditNote>[]) {
  const repo = {
    find: jest.fn(async () => existing),
    create: jest.fn((row) => row),
    save: jest.fn(async (row) => ({ cn_id: 'cn1', ...row })),
  };
  return { repo, manager: { getRepository: jest.fn(() => repo) } as never };
}

describe('CreditNoteService.issueCreditNote', () => {
  const service = Object.create(CreditNoteService.prototype) as CreditNoteService;

  it('creates an active note for the amount', async () => {
    const { manager, repo } = managerWith([]);
    const cn = await service.issueCreditNote(manager, { order, amountExVat: 280.37, reason: 'คืนสินค้า RF1', cnNumber: 'CN-RF1' });
    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({
      cn_number: 'CN-RF1', issued_from_order_id: 'o1', total_amount: 280.37, remaining_amount: 280.37, cn_status: 'active',
    }));
    expect(cn.cn_id).toBe('cn1');
  });

  it('refuses beyond the order goods ceiling (cancelled notes do not count)', async () => {
    const { manager } = managerWith([{ total_amount: 900, cn_status: 'active' }, { total_amount: 500, cn_status: 'cancelled' }]);
    await expect(service.issueCreditNote(manager, { order, amountExVat: 150, reason: 'x', cnNumber: 'CN-RF2' }))
      .rejects.toBeInstanceOf(BadRequestException);
  });
});
```

- [ ] **Step 2: Run it to verify it fails** — `npx nx test backend -- apps/backend/src/app/credit-note/credit-note.issue.spec.ts` → FAIL.

- [ ] **Step 3: Refactor**

Move the cap check and create/save out of `ingestClaimApproved` into:

```ts
  /** Cap-checked insert of an active Credit Note. Caller owns the transaction; call `notifyIssued` after commit. */
  async issueCreditNote(
    manager: EntityManager,
    input: { order: Order; amountExVat: number; reason: string; cnNumber: string },
  ): Promise<CreditNote> {
    const repo = manager.getRepository(CreditNote);
    const amount = roundMoney(Number(input.amountExVat));
    const issued = await repo.find({ where: { issued_from_order_id: input.order.orders_id } });
    // Cap: CN ex VAT already issued on this order (exhausted counts, cancelled
    // does not) + this one may not exceed the order's goods value.
    const alreadyIssued = issued
      .filter((cn) => cn.cn_status !== 'cancelled')
      .reduce((sum, cn) => sum + Number(cn.total_amount), 0);
    const refundable = roundMoney(orderGoodsCeilingExVat(input.order) - alreadyIssued);
    if (amount > refundable + CREDIT_CEILING_TOLERANCE_EX_VAT) {
      throw new BadRequestException(
        `totalAmountExVat เกินยอดที่ออก Credit Note ได้ของออเดอร์นี้ (เหลือไม่เกิน ${Math.max(0, refundable)} ex VAT)`,
      );
    }
    return repo.save(repo.create({
      cn_number: input.cnNumber,
      issued_from_order_id: input.order.orders_id,
      total_amount: amount,
      remaining_amount: amount,
      cn_status: 'active',
      claim_reason: input.reason,
    }));
  }
```

`ingestClaimApproved` keeps its validation and idempotency lookup, then does:

```ts
    const saved = await this.issueCreditNote(this.cnRepo.manager, {
      order, amountExVat: dto.totalAmountExVat, reason, cnNumber,
    });
    await this.notifyIssued(order, saved);
```

Change `private async notifyIssued` to `async notifyIssued`. Keep the old `ponytail:` comment about the missing lock where the cap now lives.

- [ ] **Step 4: Run all credit-note specs** — `npx nx test backend -- apps/backend/src/app/credit-note` → PASS (`credit-note.ingest.http.spec.ts` must still pass unchanged).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/app/credit-note
git commit -m "refactor(credit-note): extract issueCreditNote for reuse by refunds"
```

---

### Task 6: CreditBack — hold weight-diff credit behind the flag

**Files:**
- Modify: `app/credit-back/credit-back.service.ts` (`ingestInvoiceReceived` create ~line 380–392; `issueForShipment` reactivation ~535–545 and create ~555–565)
- Test: `app/credit-back/credit-back.hold.spec.ts`

**Interfaces:**
- Consumes: `isRefundFlowEnabled()` (Task 1).
- Produces:
  - With the flag on, new INVOICE_DELTA rows start `cb_status='held'`.
  - A `held` row stays `held` when amounts change.
  - A `cancelled` row is re-issued as `held`.
  - A `paid_out` row is never touched (it counts as used).
  - `notifyIssued` already skips non-`active` rows, so no notification fires while held.

- [ ] **Step 1: Write the failing test** (build the service with `Object.create(CreditBackService.prototype)` like `credit-back.service.spec.ts`)

```ts
// app/credit-back/credit-back.hold.spec.ts
import { CreditBackService } from './credit-back.service';
import { CreditBackSource } from '../../entities/credit-back.entity';

const invoice = { invoice_id: 'i1', invoice_number: 'INV1', order_id: 'o1', shipment_id: null } as never;
function managerWith(rows: Record<string, unknown>[]) {
  const repo = {
    find: jest.fn(async () => rows),
    create: jest.fn((r) => r),
    save: jest.fn(async (r) => r),
  };
  return { repo, manager: { getRepository: jest.fn(() => repo), find: jest.fn(async () => []) } as never };
}

describe('weight-diff Credit Back hold (REFUND_FLOW_ENABLED)', () => {
  const prev = process.env.REFUND_FLOW_ENABLED;
  const service = Object.create(CreditBackService.prototype) as CreditBackService;
  beforeEach(() => {
    (service as unknown as { nextCbNumber: () => Promise<string> }).nextCbNumber = async () => 'CB202600001';
    (service as unknown as { logger: unknown }).logger = { warn: jest.fn(), log: jest.fn() };
  });
  afterEach(() => { process.env.REFUND_FLOW_ENABLED = prev; });

  const input = { invoice, orderedExVat: 1000, invoicedExVat: 900, creditExVat: 100 };

  it('flag off → new row active (unchanged behaviour)', async () => {
    delete process.env.REFUND_FLOW_ENABLED;
    const { manager } = managerWith([]);
    expect((await service.issueForShipment(input, manager))?.cb_status).toBe('active');
  });

  it('flag on → new row held', async () => {
    process.env.REFUND_FLOW_ENABLED = 'true';
    const { manager } = managerWith([]);
    expect((await service.issueForShipment(input, manager))?.cb_status).toBe('held');
  });

  it('flag on → held row with a new amount stays held', async () => {
    process.env.REFUND_FLOW_ENABLED = 'true';
    const held = { cb_id: 'cb1', invoice_id: 'i1', source: CreditBackSource.INVOICE_DELTA, order_amount: 1000, invoice_amount: 950, total_amount: 50, remaining_amount: 50, cb_status: 'held' };
    const { manager } = managerWith([held]);
    const cb = await service.issueForShipment(input, manager);
    expect(cb).toMatchObject({ cb_status: 'held', total_amount: 100, remaining_amount: 100 });
  });

  it('REVIEW FOCUS 2: paid_out row is never reactivated by an invoice resend', async () => {
    process.env.REFUND_FLOW_ENABLED = 'true';
    const paidOut = { cb_id: 'cb1', invoice_id: 'i1', source: CreditBackSource.INVOICE_DELTA, order_amount: 1000, invoice_amount: 950, total_amount: 50, remaining_amount: 0, cb_status: 'paid_out' };
    const { manager, repo } = managerWith([paidOut]);
    const cb = await service.issueForShipment(input, manager);
    expect(cb).toMatchObject({ cb_status: 'paid_out', remaining_amount: 0 });
    expect(repo.save).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails** — `npx nx test backend -- apps/backend/src/app/credit-back/credit-back.hold.spec.ts` → the flag-on cases FAIL.

- [ ] **Step 3: Implement**

Add this at the top of `credit-back.service.ts`:

```ts
import { isRefundFlowEnabled } from '../refund-requests/refund-flow.flag';

/** Status for a newly issued / re-issued weight-diff Credit Back. */
const freshDeltaStatus = () => (isRefundFlowEnabled() ? 'held' : 'active');
```

- In `ingestInvoiceReceived`'s `cbRepo.create({...})`: `cb_status: freshDeltaStatus(),`
- In `issueForShipment`'s final `cbRepo.create({...})`: `cb_status: freshDeltaStatus(),`
- In the reactivation `Object.assign(existing, {...})`: `cb_status: existing.cb_status === 'held' ? 'held' : existing.cb_status === 'cancelled' ? freshDeltaStatus() : 'active',`

`wasUsed` already treats `paid_out` as used (status ≠ cancelled and total − remaining > 0.01), so the early `return existing` covers Review Focus 2. Add a comment saying so above `wasUsed`.

- [ ] **Step 4: Run all credit-back specs** — `npx nx test backend -- apps/backend/src/app/credit-back` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/app/credit-back
git commit -m "feat(credit-back): hold weight-diff credit backs for the refund choice (flagged)"
```

---

### Task 7: Customer service — options, report a return, bank accounts, choose method, read

**Files:**
- Create: `app/refund-requests/refund-requests.service.ts`
- Create: `app/refund-requests/refund-order-money.ts` (SQL loaders shared with the admin service)
- Test: `app/refund-requests/refund-requests.service.spec.ts`

**Interfaces:**
- Consumes: Tasks 1–3 helpers and entities, `MediaStorageService`, `isKbankSandbox()`.
- Produces:
  - `loadPaidCharge(manager: EntityManager, orderId: string): Promise<PaidCharge | null>`
  - `loadOrderMoney(manager: EntityManager, orderId: string, charge: PaidCharge | null, excludeRequestId?: string): Promise<OrderMoney>`, where `OrderMoney = { cashPaidIncVat; creditUsedIncVat; maxRefundableIncVat; alreadyRefundedIncVat; cashAlreadyRefundedIncVat }`
  - `refundedBeforeOnCharge(manager: EntityManager, txnId: string, excludeRequestId: string): Promise<number>`
  - `RefundRequestsService` methods:
    - `getReturnableItems(userId, orderId)`
    - `createReturn(userId, dto: CreateReturnInput, evidence: Express.Multer.File[])`
    - `listBankAccounts(userId)`
    - `createBankAccount(userId, dto: CreateBankAccountInput, bookbank: Express.Multer.File)`
    - `chooseMethod(userId, id, dto: ChooseMethodInput)`
    - `list(userId, orderId?)`
    - `getDetail(userId, id)`
  - Helper `refundToLabelFor(...)` and exported `toCustomerDetail(...)`.

`refund-order-money.ts` uses SQL against the existing tables:

```ts
// app/refund-requests/refund-order-money.ts
import { EntityManager } from 'typeorm';
import { roundMoney } from '../../shared/helpers/vat.helper';
import { CASH_OUT_STATUSES } from '../../entities/refund-request.entity';
import { PaidCharge } from './refund-methods.helper';
import { toIncVat } from './refund-amount.helper';

/**
 * Latest success charge of the order — direct (payment_transactions.order_id) or batch (payment_transaction_orders).
 * ponytail: one charge per order assumed; an order with several success charges uses the latest only — split it
 * across charges if double-paid orders show up in the admin queue.
 */
export async function loadPaidCharge(manager: EntityManager, orderId: string): Promise<PaidCharge | null> {
  const rows: Array<Record<string, unknown>> = await manager.query(
    `SELECT txn.id, txn.gateway_charge_id, txn.gateway_provider, txn.payment_method, txn.amount,
            COALESCE(link.allocated_amount, txn.amount) AS order_share, txn.paid_at, txn.card_last4,
            txn.is_test, txn.gateway_response
       FROM payment_transactions txn
       LEFT JOIN payment_transaction_orders link ON link.transaction_id = txn.id
      WHERE COALESCE(link.order_id, txn.order_id) = $1 AND txn.status = 'success'
      ORDER BY txn.paid_at DESC NULLS LAST, txn.created_at DESC
      LIMIT 1`,
    [orderId],
  );
  const r = rows[0];
  if (!r) return null;
  const resp = (r.gateway_response ?? {}) as { card?: { brand?: string }; source?: { brand?: string } };
  return {
    id: String(r.id),
    gatewayChargeId: (r.gateway_charge_id as string) ?? null,
    gatewayProvider: String(r.gateway_provider),
    paymentMethod: String(r.payment_method),
    chargeAmount: Number(r.amount),
    orderShare: Number(r.order_share),
    paidAt: r.paid_at ? new Date(r.paid_at as string) : null,
    cardLast4: (r.card_last4 as string) ?? null,
    cardBrand: resp.card?.brand ?? resp.source?.brand ?? null,
    isTest: r.is_test === true,
  };
}

export type OrderMoney = {
  cashPaidIncVat: number;
  creditUsedIncVat: number;
  maxRefundableIncVat: number;
  alreadyRefundedIncVat: number;
  cashAlreadyRefundedIncVat: number;
};

/**
 * What the customer handed over for the order and what has gone back already (decisions 4–5).
 * Counts every refund request not rejected/cancelled, plus Credit Notes / Credit Backs issued outside
 * this flow (old CS-CRM claims, weight diff with the flag off) so nothing is paid twice.
 */
export async function loadOrderMoney(
  manager: EntityManager, orderId: string, charge: PaidCharge | null, excludeRequestId?: string,
): Promise<OrderMoney> {
  const [order] = await manager.query(`SELECT total_price FROM orders WHERE orders_id = $1`, [orderId]);
  const cashPaidIncVat = roundMoney(charge && charge.gatewayProvider !== 'credit_terms' ? charge.orderShare : Number(order?.total_price ?? 0));
  const [credit] = await manager.query(
    `SELECT
       COALESCE((SELECT SUM(amount_used - released_amount) FROM order_credit_back_usages WHERE applied_to_order_id = $1), 0) AS cb_used,
       COALESCE((SELECT SUM(amount_used - released_amount) FROM order_credit_note_usages WHERE applied_to_order_id = $1), 0) AS cn_used`,
    [orderId],
  );
  const creditUsedIncVat = toIncVat(Number(credit.cb_used) + Number(credit.cn_used));
  const [out] = await manager.query(
    `SELECT
       COALESCE((SELECT SUM(amount_inc_vat) FROM refund_requests
                  WHERE order_id = $1 AND status NOT IN ('rejected','cancelled') AND id IS DISTINCT FROM $2), 0) AS requests,
       COALESCE((SELECT SUM(cash_amount_inc_vat) FROM refund_requests
                  WHERE order_id = $1 AND status = ANY($3) AND id IS DISTINCT FROM $2), 0) AS cash,
       COALESCE((SELECT SUM(total_amount) FROM credit_backs cb
                  WHERE cb.issued_from_order_id = $1 AND cb.cb_status <> 'cancelled'
                    AND NOT EXISTS (SELECT 1 FROM refund_requests rr WHERE rr.credit_back_id = cb.cb_id)), 0) AS cb_outside,
       COALESCE((SELECT SUM(total_amount) FROM credit_notes cn
                  WHERE cn.issued_from_order_id = $1 AND cn.cn_status <> 'cancelled'
                    AND NOT EXISTS (SELECT 1 FROM refund_requests rr WHERE rr.credit_note_id = cn.cn_id)), 0) AS cn_outside`,
    [orderId, excludeRequestId ?? null, [...CASH_OUT_STATUSES]],
  );
  return {
    cashPaidIncVat,
    creditUsedIncVat,
    maxRefundableIncVat: roundMoney(cashPaidIncVat + creditUsedIncVat),
    alreadyRefundedIncVat: roundMoney(Number(out.requests) + toIncVat(Number(out.cb_outside) + Number(out.cn_outside))),
    cashAlreadyRefundedIncVat: roundMoney(Number(out.cash)),
  };
}

/** Cash already sent back on one charge through this flow — decides void vs refund. */
export async function refundedBeforeOnCharge(manager: EntityManager, txnId: string, excludeRequestId: string): Promise<number> {
  const [r] = await manager.query(
    `SELECT COALESCE(SUM(cash_amount_inc_vat), 0) AS total FROM refund_requests
      WHERE payment_transaction_id = $1 AND gateway_status = 'success' AND id <> $2`,
    [txnId, excludeRequestId],
  );
  return roundMoney(Number(r.total));
}
```

- [ ] **Step 1: Write the failing service tests**

Build the service with `Object.create(RefundRequestsService.prototype)`, then assign `dataSource` (with `transaction: (fn) => fn(manager)`), `mediaStorage`, and `jest.spyOn` on the module functions from `refund-order-money.ts`. Cover these cases:

```ts
// app/refund-requests/refund-requests.service.spec.ts
import { NotFoundException, BadRequestException } from '@nestjs/common';
import * as money from './refund-order-money';
import { RefundRequestsService } from './refund-requests.service';
import { RefundMethod, RefundRequestSource, RefundRequestStatus } from '../../entities/refund-request.entity';

const ORDER = { orders_id: 'o1', user_id: 'u1', status: 'delivered', order_number: 'SO1', created_at: new Date('2026-06-16T11:01:00Z') };
const items = [{ id: 'a', order_id: 'o1', product_price: 300, product_quantity: 2 }, { id: 'b', order_id: 'o1', product_price: 700, product_quantity: 1 }];

function makeService(over: { requested?: Array<{ order_item_id: string; quantity: number }> } = {}) {
  const saved: Record<string, unknown>[] = [];
  const manager = {
    findOne: jest.fn(async (entity: { name?: string }, opts: { where: Record<string, unknown> }) => {
      if (entity.name === 'Order') return opts.where.orders_id === 'o1' ? { ...ORDER } : null;
      return null;
    }),
    find: jest.fn(async () => items),
    query: jest.fn(async () => over.requested ?? []),
    create: jest.fn((_e, row) => row),
    save: jest.fn(async (_e, row) => { const r = Array.isArray(row) ? row : { id: 'rr1', ...row }; saved.push(r); return r; }),
  };
  const service = Object.create(RefundRequestsService.prototype) as RefundRequestsService;
  Object.assign(service, {
    dataSource: { transaction: (fn: (m: typeof manager) => unknown) => fn(manager), manager },
    mediaStorage: { uploadPrivateMulterFile: jest.fn(async (_f, dest) => `${dest}/x.jpg`) },
    notifier: { notify: jest.fn() },
  });
  jest.spyOn(money, 'loadPaidCharge').mockResolvedValue(null);
  jest.spyOn(money, 'loadOrderMoney').mockResolvedValue({
    cashPaidIncVat: 900, creditUsedIncVat: 0, maxRefundableIncVat: 900, alreadyRefundedIncVat: 0, cashAlreadyRefundedIncVat: 0,
  });
  return { service, manager, saved };
}
const photo = { originalname: 'p.jpg', size: 1000, mimetype: 'image/jpeg' } as Express.Multer.File;

describe('RefundRequestsService.createReturn', () => {
  it('creates an awaiting_method return priced from product_price × qty, evidence uploaded privately', async () => {
    const { service, saved } = makeService();
    const res = await service.createReturn('u1', { orderId: 'o1', reason: 'ของเสีย', items: [{ orderItemId: 'a', quantity: 1 }] }, [photo]);
    expect(res.data.amountIncVat).toBe(300);
    expect(saved[0]).toMatchObject({
      source: RefundRequestSource.RETURN, status: RefundRequestStatus.AWAITING_METHOD, amount_inc_vat: 300,
      requested_by_user_id: 'u1', evidence_keys: ['refund-evidence/o1/x.jpg'],
    });
  });

  it('locks the order row (REVIEW FOCUS 4) and counts qty already requested', async () => {
    const { service, manager } = makeService({ requested: [{ order_item_id: 'a', quantity: 2 }] });
    await expect(service.createReturn('u1', { orderId: 'o1', reason: 'x', items: [{ orderItemId: 'a', quantity: 1 }] }, [photo]))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(manager.findOne).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ lock: { mode: 'pessimistic_write' } }));
  });

  it('needs at least one photo and caps the amount at what was paid', async () => {
    const { service } = makeService();
    await expect(service.createReturn('u1', { orderId: 'o1', reason: 'x', items: [{ orderItemId: 'a', quantity: 1 }] }, []))
      .rejects.toBeInstanceOf(BadRequestException);
    jest.spyOn(money, 'loadOrderMoney').mockResolvedValue({
      cashPaidIncVat: 900, creditUsedIncVat: 0, maxRefundableIncVat: 900, alreadyRefundedIncVat: 800, cashAlreadyRefundedIncVat: 0,
    });
    const res = await service.createReturn('u1', { orderId: 'o1', reason: 'x', items: [{ orderItemId: 'a', quantity: 1 }] }, [photo]);
    expect(res.data.amountIncVat).toBe(100);
  });

  it('REVIEW FOCUS 5: not the orderer → 404', async () => {
    const { service } = makeService();
    await expect(service.createReturn('someone-else', { orderId: 'o1', reason: 'x', items: [{ orderItemId: 'a', quantity: 1 }] }, [photo]))
      .rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('RefundRequestsService.chooseMethod', () => {
  const QR = { id: 't1', gatewayChargeId: 'J1', gatewayProvider: 'jagota', paymentMethod: 'qr', chargeAmount: 900, orderShare: 900, paidAt: new Date(), cardLast4: null, cardBrand: null, isTest: false };
  function setup(status = RefundRequestStatus.AWAITING_METHOD, account: Record<string, unknown> | null = { id: 'ba1', user_id: 'u1', company_id: 'c1', deleted_at: null }) {
    const request = { id: 'rr1', order_id: 'o1', order: { user_id: 'u1' }, status, source: RefundRequestSource.RETURN, amount_inc_vat: 500 };
    const manager = {
      findOne: jest.fn(async (entity: { name?: string }) =>
        entity.name === 'RefundRequest' ? { ...request }
          : entity.name === 'RefundBankAccount' ? account
            : entity.name === 'User' ? { id: 'u1', company_id: 'c1' } : null),
      save: jest.fn(async (_e, row) => row),
    };
    const service = Object.create(RefundRequestsService.prototype) as RefundRequestsService;
    Object.assign(service, { dataSource: { transaction: (fn: (m: typeof manager) => unknown) => fn(manager), manager } });
    jest.spyOn(money, 'loadPaidCharge').mockResolvedValue(QR);
    jest.spyOn(money, 'loadOrderMoney').mockResolvedValue({
      cashPaidIncVat: 900, creditUsedIncVat: 0, maxRefundableIncVat: 900, alreadyRefundedIncVat: 0, cashAlreadyRefundedIncVat: 0,
    });
    return { service, manager };
  }
  const bank = { method: RefundMethod.BANK_TRANSFER, cashReason: 'other' as never, cashReasonNote: 'บัญชีต้องการ', bankAccountId: 'ba1', policyVersion: '2026-10-v1' };

  it('bank transfer needs a cash reason, the current policy version and an own bank account', async () => {
    await expect(setup().service.chooseMethod('u1', 'rr1', { ...bank, cashReason: undefined })).rejects.toBeInstanceOf(BadRequestException);
    await expect(setup().service.chooseMethod('u1', 'rr1', { ...bank, policyVersion: 'old' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(setup(RefundRequestStatus.AWAITING_METHOD, { id: 'ba1', user_id: 'x', company_id: 'other-co', deleted_at: null })
      .service.chooseMethod('u1', 'rr1', bank)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('moves to under_review and stores method, reason, policy acceptance, method_chosen_at', async () => {
    const { service, manager } = setup();
    await service.chooseMethod('u1', 'rr1', bank);
    expect(manager.save).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      method: RefundMethod.BANK_TRANSFER, status: RefundRequestStatus.UNDER_REVIEW, cash_reason: 'other',
      cash_reason_note: 'บัญชีต้องการ', bank_account_id: 'ba1', policy_version: '2026-10-v1',
      policy_accepted_at: expect.any(Date), method_chosen_at: expect.any(Date),
    }));
  });

  it('refuses card on a QR order, and refuses once the request is past review', async () => {
    await expect(setup().service.chooseMethod('u1', 'rr1', { method: RefundMethod.CARD, cashReason: 'other' as never }))
      .rejects.toThrow('วิธีคืนเงินนี้ใช้กับคำขอนี้ไม่ได้');
    await expect(setup(RefundRequestStatus.PROCESSING).service.chooseMethod('u1', 'rr1', { method: RefundMethod.CREDIT }))
      .rejects.toThrow('สถานะคำขอนี้เปลี่ยนวิธีคืนเงินไม่ได้');
  });

  it('REVIEW FOCUS 5: another user → 404', async () => {
    await expect(setup().service.chooseMethod('someone-else', 'rr1', { method: RefundMethod.CREDIT })).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('customerStatus', () => {
  it('maps internal statuses to what the customer sees', () => {
    expect(customerStatus(RefundRequestStatus.AWAITING_METHOD)).toBe('action_required');
    expect(customerStatus(RefundRequestStatus.CHANGES_REQUESTED)).toBe('action_required');
    for (const s of [RefundRequestStatus.UNDER_REVIEW, RefundRequestStatus.PROCESSING, RefundRequestStatus.AWAITING_TRANSFER, RefundRequestStatus.FAILED]) {
      expect(customerStatus(s)).toBe('processing');
    }
    expect(customerStatus(RefundRequestStatus.COMPLETED)).toBe('completed');
  });
});
```

Add `customerStatus` to the import from `./refund-requests.service`.

- [ ] **Step 2: Run to verify it fails** — `npx nx test backend -- apps/backend/src/app/refund-requests/refund-requests.service.spec.ts` → FAIL.

- [ ] **Step 3: Implement `refund-requests.service.ts`**

```ts
// app/refund-requests/refund-requests.service.ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In } from 'typeorm';
import { Order } from '../../entities/order.entity';
import { OrderItem } from '../../entities/order-item.entity';
import { User } from '../../entities/user.entity';
import {
  OPEN_REFUND_STATUSES, RefundCashReason, RefundMethod, RefundRequest, RefundRequestSource, RefundRequestStatus,
} from '../../entities/refund-request.entity';
import { RefundRequestItem } from '../../entities/refund-request-item.entity';
import { RefundBankAccount } from '../../entities/refund-bank-account.entity';
import { MediaStorageService } from '../../shared/media/media-storage.service';
import { encryptPii } from '../../shared/helpers/pii-cipher.helper';
import { assertOrderCreditable } from '../../shared/helpers/order-credit-ceiling.helper';
import { isKbankSandbox } from '../payment/kbank/kbank.config';
import { capRefundAmount, priceReturnLines } from './refund-amount.helper';
import { availableMethods, MIN_CASH_REFUND_INC_VAT, PaidCharge } from './refund-methods.helper';
import { findRefundBank, isValidAccountNumber, REFUND_BANKS } from './refund-banks';
import { BANK_TRANSFER_POLICY } from './refund-policy';
import { loadOrderMoney, loadPaidCharge } from './refund-order-money';
import { RefundNotifier } from './refund-notifier';

export type CreateReturnInput = { orderId: string; reason: string; items: { orderItemId: string; quantity: number }[] };
export type CreateBankAccountInput = { bankCode: string; accountNumber: string; holderName: string; save: boolean };
export type ChooseMethodInput = {
  method: RefundMethod;
  cashReason?: RefundCashReason;
  cashReasonNote?: string;
  bankAccountId?: string;
  policyVersion?: string;
};

const CHOOSABLE: readonly RefundRequestStatus[] = OPEN_REFUND_STATUSES;
export const REFUND_EVIDENCE_DIR = 'refund-evidence';
export const REFUND_BOOKBANK_DIR = 'refund-bookbank';
const ok = <T>(data: T, message: string) => ({ status: true, statusCode: 200, message, data });

export function customerStatus(s: RefundRequestStatus): 'action_required' | 'processing' | 'completed' | 'rejected' | 'cancelled' {
  if (s === RefundRequestStatus.AWAITING_METHOD || s === RefundRequestStatus.CHANGES_REQUESTED) return 'action_required';
  if (s === RefundRequestStatus.COMPLETED) return 'completed';
  if (s === RefundRequestStatus.REJECTED) return 'rejected';
  if (s === RefundRequestStatus.CANCELLED) return 'cancelled';
  return 'processing';
}

/** "Refund to" (Figma): card → `Visa *1234`, bank → `Siam Commercial Bank *1234`, credit → CN/CB number. */
export function refundToLabelFor(i: { method: RefundMethod; charge?: PaidCharge | null; bankCode?: string; last4?: string; creditNumber?: string }): string | null {
  if (i.method === RefundMethod.CARD) {
    const brand = i.charge?.cardBrand ? i.charge.cardBrand[0].toUpperCase() + i.charge.cardBrand.slice(1) : 'Card';
    return i.charge?.cardLast4 ? `${brand} *${i.charge.cardLast4}` : brand;
  }
  if (i.method === RefundMethod.BANK_TRANSFER) return `${findRefundBank(i.bankCode ?? '')?.nameEn ?? i.bankCode} *${i.last4}`;
  return i.creditNumber ?? null;
}

@Injectable()
export class RefundRequestsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly mediaStorage: MediaStorageService,
    private readonly notifier: RefundNotifier,
  ) {}

  banks() {
    return ok(REFUND_BANKS.map(({ code, nameEn, nameTh, digits }) => ({ code, nameEn, nameTh, accountDigits: digits })), 'รายชื่อธนาคาร');
  }

  policy(lang: 'th' | 'en') {
    return ok({ version: BANK_TRANSFER_POLICY.version, ...BANK_TRANSFER_POLICY[lang] }, 'เงื่อนไขการคืนเงิน');
  }

  /** Orderer-only (actions), like cancelOrder. */
  private async loadOwnOrder(manager: EntityManager, userId: string, orderId: string, lock = false): Promise<Order> {
    const order = await manager.findOne(Order, {
      where: { orders_id: orderId },
      ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
    if (!order || order.user_id !== userId) throw new NotFoundException('ไม่พบออเดอร์');
    return order;
  }

  private async requestedQty(manager: EntityManager, orderItemIds: string[]): Promise<Map<string, number>> {
    const rows: Array<{ order_item_id: string; quantity: string | number }> = await manager.query(
      `SELECT i.order_item_id, SUM(i.quantity) AS quantity
         FROM refund_request_items i JOIN refund_requests r ON r.id = i.refund_request_id
        WHERE i.order_item_id = ANY($1) AND r.status NOT IN ('rejected','cancelled')
        GROUP BY i.order_item_id`,
      [orderItemIds],
    );
    return new Map(rows.map((r) => [r.order_item_id, Number(r.quantity)]));
  }

  async getReturnableItems(userId: string, orderId: string) {
    const manager = this.dataSource.manager;
    const order = await this.loadOwnOrder(manager, userId, orderId);
    assertOrderCreditable(order);
    const lines = await manager.find(OrderItem, { where: { order_id: orderId } });
    const requested = await this.requestedQty(manager, lines.map((l) => l.id));
    return ok(lines.map((l) => ({
      orderItemId: l.id,
      productInventoryId: l.product_inventory_id,
      quantityOrdered: l.product_quantity,
      quantityReturnable: l.product_quantity - (requested.get(l.id) ?? 0),
      unitPriceIncVat: Number(l.product_price),
    })), 'รายการที่ขอคืนได้');
  }

  async createReturn(userId: string, dto: CreateReturnInput, evidence: Express.Multer.File[]) {
    if (!evidence?.length) throw new BadRequestException('กรุณาแนบรูปสินค้าที่มีปัญหาอย่างน้อย 1 รูป');
    const reason = dto.reason?.trim();
    if (!reason) throw new BadRequestException('กรุณาระบุเหตุผล');
    const saved = await this.dataSource.transaction(async (manager) => {
      const order = await this.loadOwnOrder(manager, userId, dto.orderId, true);
      assertOrderCreditable(order);
      const lines = await manager.find(OrderItem, { where: { order_id: order.orders_id } });
      const requested = await this.requestedQty(manager, lines.map((l) => l.id));
      const priced = priceReturnLines(
        lines.map((l) => ({ id: l.id, productPrice: Number(l.product_price), productQuantity: l.product_quantity, alreadyRequested: requested.get(l.id) ?? 0 })),
        dto.items,
      );
      const charge = await loadPaidCharge(manager, order.orders_id);
      const money = await loadOrderMoney(manager, order.orders_id, charge);
      const amount = capRefundAmount({
        requestedIncVat: priced.reduce((s, p) => s + p.amountIncVat, 0),
        maxRefundableIncVat: money.maxRefundableIncVat,
        alreadyRefundedIncVat: money.alreadyRefundedIncVat,
      });
      if (amount <= 0) throw new BadRequestException('ออเดอร์นี้คืนเงินครบยอดที่ชำระแล้ว');
      const keys = await Promise.all(evidence.map((f) => this.mediaStorage.uploadPrivateMulterFile(f, `${REFUND_EVIDENCE_DIR}/${order.orders_id}`)));
      const row = await manager.save(RefundRequest, manager.create(RefundRequest, {
        order_id: order.orders_id, source: RefundRequestSource.RETURN, status: RefundRequestStatus.AWAITING_METHOD,
        reason, amount_inc_vat: amount, requested_by_user_id: userId, evidence_keys: keys,
      }));
      await manager.save(RefundRequestItem, priced.map((p) => manager.create(RefundRequestItem, {
        refund_request_id: row.id, order_item_id: p.orderItemId, quantity: p.quantity, amount_inc_vat: p.amountIncVat,
      })));
      return row;
    });
    return ok({ refundRequestId: saved.id, amountIncVat: Number(saved.amount_inc_vat), status: saved.status }, 'ส่งคำขอคืนสินค้าแล้ว');
  }

  private async bankOwner(userId: string): Promise<{ userId: string; companyId: string | null }> {
    const user = await this.dataSource.manager.findOne(User, { where: { id: userId } });
    return { userId, companyId: (user as unknown as { company_id?: string | null })?.company_id ?? null };
  }

  private ownsBankAccount(acc: RefundBankAccount, owner: { userId: string; companyId: string | null }) {
    return owner.companyId ? acc.company_id === owner.companyId : acc.user_id === owner.userId;
  }

  async listBankAccounts(userId: string) {
    const owner = await this.bankOwner(userId);
    const rows = await this.dataSource.manager.find(RefundBankAccount, {
      where: owner.companyId
        ? { company_id: owner.companyId, saved: true, deleted_at: null as never }
        : { user_id: userId, saved: true, deleted_at: null as never },
      order: { created_at: 'DESC' },
    });
    return ok(rows.map((r) => this.toBankAccountView(r)), 'บัญชีที่บันทึกไว้');
  }

  toBankAccountView(r: RefundBankAccount) {
    const bank = findRefundBank(r.bank_code);
    return { bankAccountId: r.id, bankCode: r.bank_code, bankNameEn: bank?.nameEn ?? r.bank_code, bankNameTh: bank?.nameTh ?? r.bank_code, accountLast4: r.account_last4, holderName: r.holder_name, saved: r.saved };
  }

  async createBankAccount(userId: string, dto: CreateBankAccountInput, bookbank: Express.Multer.File | undefined) {
    if (!bookbank) throw new BadRequestException('กรุณาแนบรูปหน้าสมุดบัญชี');
    const digits = dto.accountNumber.replace(/[\s-]/g, '');
    if (!isValidAccountNumber(dto.bankCode, digits)) throw new BadRequestException('เลขบัญชีไม่ถูกต้องสำหรับธนาคารนี้');
    const holderName = dto.holderName?.trim();
    if (!holderName) throw new BadRequestException('กรุณาระบุชื่อบัญชี');
    const owner = await this.bankOwner(userId);
    const key = await this.mediaStorage.uploadPrivateMulterFile(bookbank, `${REFUND_BOOKBANK_DIR}/${owner.companyId ?? userId}`);
    const manager = this.dataSource.manager;
    const row = await manager.save(RefundBankAccount, manager.create(RefundBankAccount, {
      company_id: owner.companyId, user_id: userId, bank_code: dto.bankCode,
      account_number_enc: encryptPii(digits), account_last4: digits.slice(-4), holder_name: holderName,
      bookbank_key: key, saved: dto.save === true,
    }));
    return ok(this.toBankAccountView(row), 'บันทึกบัญชีแล้ว');
  }

  private async loadOwnRequest(manager: EntityManager, userId: string, id: string, lock = false): Promise<RefundRequest> {
    const r = await manager.findOne(RefundRequest, {
      where: { id }, relations: ['order'],
      ...(lock ? { lock: { mode: 'pessimistic_write' as const, tables: ['refund_requests'] } } : {}),
    });
    if (!r || r.order?.user_id !== userId) throw new NotFoundException('ไม่พบคำขอคืนเงิน');
    return r;
  }

  private async methodsFor(manager: EntityManager, r: RefundRequest) {
    const charge = await loadPaidCharge(manager, r.order_id);
    const money = await loadOrderMoney(manager, r.order_id, charge, r.id);
    const methods = availableMethods({
      amountIncVat: Number(r.amount_inc_vat), charge,
      cashRemainingIncVat: money.cashPaidIncVat - money.cashAlreadyRefundedIncVat,
      now: new Date(), sandbox: isKbankSandbox(), allowSplit: r.source === RefundRequestSource.RETURN,
    });
    return { charge, money, methods };
  }

  async chooseMethod(userId: string, id: string, dto: ChooseMethodInput) {
    const saved = await this.dataSource.transaction(async (manager) => {
      const r = await this.loadOwnRequest(manager, userId, id, true);
      if (!CHOOSABLE.includes(r.status)) throw new BadRequestException('สถานะคำขอนี้เปลี่ยนวิธีคืนเงินไม่ได้');
      const { methods } = await this.methodsFor(manager, r);
      if (!methods.includes(dto.method)) throw new BadRequestException('วิธีคืนเงินนี้ใช้กับคำขอนี้ไม่ได้');
      const cash = dto.method !== RefundMethod.CREDIT;
      if (cash && !dto.cashReason) throw new BadRequestException('กรุณาเลือกเหตุผลที่ต้องการรับเงินคืน');
      let bankAccountId: string | null = null;
      if (dto.method === RefundMethod.BANK_TRANSFER) {
        if (dto.policyVersion !== BANK_TRANSFER_POLICY.version) throw new BadRequestException('กรุณายอมรับเงื่อนไขการคืนเงินฉบับล่าสุด');
        const acc = dto.bankAccountId ? await manager.findOne(RefundBankAccount, { where: { id: dto.bankAccountId } }) : null;
        if (!acc || acc.deleted_at || !this.ownsBankAccount(acc, await this.bankOwner(userId))) throw new NotFoundException('ไม่พบบัญชีธนาคาร');
        bankAccountId = acc.id;
      }
      Object.assign(r, {
        method: dto.method,
        cash_reason: cash ? dto.cashReason : null,
        cash_reason_note: cash && dto.cashReason === RefundCashReason.OTHER ? dto.cashReasonNote?.trim().slice(0, 500) || null : null,
        bank_account_id: bankAccountId,
        policy_version: bankAccountId ? BANK_TRANSFER_POLICY.version : null,
        policy_accepted_at: bankAccountId ? new Date() : null,
        method_chosen_at: new Date(),
        changes_requested_reason: null,
        status: RefundRequestStatus.UNDER_REVIEW,
      });
      return manager.save(RefundRequest, r);
    });
    return ok({ refundRequestId: saved.id, status: saved.status, method: saved.method }, 'บันทึกวิธีคืนเงินแล้ว');
  }

  async list(userId: string, orderId?: string) {
    const qb = this.dataSource.manager.createQueryBuilder(RefundRequest, 'r')
      .innerJoin('r.order', 'o').where('o.user_id = :userId', { userId }).orderBy('r.created_at', 'DESC').take(50);
    if (orderId) qb.andWhere('r.order_id = :orderId', { orderId });
    const rows = await qb.getMany();
    return ok(rows.map((r) => ({
      refundRequestId: r.id, refundNumber: r.refund_number, orderId: r.order_id, source: r.source,
      status: r.status, displayStatus: customerStatus(r.status), amountIncVat: Number(r.amount_inc_vat), createdAt: r.created_at.toISOString(),
    })), 'รายการคำขอคืนเงิน');
  }

  async getDetail(userId: string, id: string) {
    const manager = this.dataSource.manager;
    const r = await this.loadOwnRequest(manager, userId, id);
    const full = await manager.findOne(RefundRequest, {
      where: { id }, relations: ['items', 'items.orderItem', 'items.orderItem.productInventory', 'items.orderItem.productInventory.translations', 'items.orderItem.productInventory.media', 'bankAccount'],
    });
    const { charge, methods } = await this.methodsFor(manager, r);
    const credited = r.source === RefundRequestSource.WEIGHT_DIFF
      ? Number((await manager.query(`SELECT COUNT(*)::int AS n FROM order_items WHERE order_id = $1 AND credited_amount_ex_vat > 0`, [r.order_id]))[0].n)
      : null;
    const name = (t?: Array<{ language_code: string; product_name: string }>) =>
      t?.find((x) => x.language_code === 'th')?.product_name ?? t?.find((x) => x.language_code === 'en')?.product_name ?? t?.[0]?.product_name ?? '-';
    return ok({
      refundRequestId: r.id, refundNumber: r.refund_number, orderId: r.order_id, orderNumber: r.order.order_number ?? null,
      source: r.source, status: r.status, displayStatus: customerStatus(r.status),
      amountIncVat: Number(r.amount_inc_vat),
      reason: r.source === RefundRequestSource.WEIGHT_DIFF ? null : r.reason,
      weightAdjustedItemCount: credited,
      items: (full?.items ?? []).map((i) => ({
        orderItemId: i.order_item_id, productName: name(i.orderItem.productInventory?.translations),
        sku: i.orderItem.productInventory?.product_inventory_sku ?? null, quantity: i.quantity,
        amountIncVat: Number(i.amount_inc_vat), imageUrl: i.orderItem.productInventory?.media?.[0]?.source ?? null,
      })),
      method: r.method, availableMethods: OPEN_REFUND_STATUSES.includes(r.status) ? methods : [],
      cashMinimumIncVat: MIN_CASH_REFUND_INC_VAT,
      refundTo: r.refund_to_label ?? (r.method ? refundToLabelFor({ method: r.method, charge, bankCode: full?.bankAccount?.bank_code, last4: full?.bankAccount?.account_last4 }) : null),
      bankAccount: full?.bankAccount ? this.toBankAccountView(full.bankAccount) : null,
      changesRequestedReason: r.changes_requested_reason, rejectReason: r.reject_reason,
      orderTime: r.order.created_at?.toISOString() ?? null, paymentTime: charge?.paidAt?.toISOString() ?? null,
      reportedTime: r.created_at.toISOString(), approvedTime: r.approved_at?.toISOString() ?? null,
      refundedTime: r.completed_at?.toISOString() ?? null,
    }, 'ดึงข้อมูลคำขอคืนเงินสำเร็จ');
  }
}
```

Field names to double-check against `entities/order-item.entity.ts` / `product-inventory`: `product_inventory_id`, `productInventory.product_inventory_sku`, `translations`, `media[0].source`. They are used the same way in `app/refunds/refunds.service.ts:35-80`, so copy from there if any differ. `RefundNotifier` is created in Task 11. Until then, add a stub `refund-notifier.ts` that exports `class RefundNotifier { async notify(_r: unknown): Promise<void> {} }`, and Task 11 fills it in.

- [ ] **Step 4: Run tests** → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/app/refund-requests
git commit -m "feat(refund): customer refund service — returns, bank accounts, method choice, detail"
```

---

### Task 8: Customer controller, DTOs, module wiring

**Files:**
- Create: `app/refund-requests/dto/refund-requests.dto.ts`
- Create: `app/refund-requests/refund-requests.controller.ts`
- Create: `app/refund-requests/refund-requests.module.ts`
- Modify: `app/app.module.ts` (import `RefundRequestsModule`)
- Test: `app/refund-requests/dto/refund-requests.dto.spec.ts`

**Interfaces:**
- Consumes: `RefundRequestsService` (Task 7).
- Produces the HTTP routes (all `HybridAuthGuard`, user from `req.user.sub`):

| Method | Path | Body |
|---|---|---|
| GET | `/refund-requests/banks` | — |
| GET | `/refund-requests/policy?lang=th\|en` | — |
| GET | `/refund-requests/bank-accounts` | — |
| POST | `/refund-requests/bank-accounts` | multipart: `bankCode, accountNumber, holderName, save` + file `bookbank` |
| GET | `/refund-requests/orders/:orderId/returnable-items` | — |
| POST | `/refund-requests` | multipart: `orderId, reason, items` (JSON string) + files `evidence[]` (≤5) |
| GET | `/refund-requests?orderId=` | — |
| GET | `/refund-requests/:id` | — |
| POST | `/refund-requests/:id/method` | JSON `ChooseMethodDto` |

- [ ] **Step 1: Write the failing DTO test**

```ts
// app/refund-requests/dto/refund-requests.dto.spec.ts
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ChooseMethodDto, CreateBankAccountDto, CreateReturnDto } from './refund-requests.dto';

describe('refund DTOs', () => {
  it('CreateReturnDto parses items from a multipart JSON string', async () => {
    const dto = plainToInstance(CreateReturnDto, {
      orderId: '6f1c1d2e-0000-4000-8000-000000000001', reason: 'เสีย',
      items: JSON.stringify([{ orderItemId: '6f1c1d2e-0000-4000-8000-000000000002', quantity: '2' }]),
    });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.items[0].quantity).toBe(2);
  });
  it('CreateReturnDto rejects bad JSON / empty items', async () => {
    expect(await validate(plainToInstance(CreateReturnDto, { orderId: '6f1c1d2e-0000-4000-8000-000000000001', reason: 'x', items: '[]' }))).not.toHaveLength(0);
    expect(await validate(plainToInstance(CreateReturnDto, { orderId: '6f1c1d2e-0000-4000-8000-000000000001', reason: 'x', items: 'nope' }))).not.toHaveLength(0);
  });
  it('CreateBankAccountDto parses save "true"/"false" from multipart', () => {
    expect(plainToInstance(CreateBankAccountDto, { bankCode: 'SCB', accountNumber: '1234567890', holderName: 'A', save: 'true' }).save).toBe(true);
    expect(plainToInstance(CreateBankAccountDto, { bankCode: 'SCB', accountNumber: '1234567890', holderName: 'A', save: 'false' }).save).toBe(false);
  });
  it('ChooseMethodDto limits enums and note length', async () => {
    expect(await validate(plainToInstance(ChooseMethodDto, { method: 'cash' }))).not.toHaveLength(0);
    expect(await validate(plainToInstance(ChooseMethodDto, { method: 'credit' }))).toHaveLength(0);
    expect(await validate(plainToInstance(ChooseMethodDto, { method: 'bank_transfer', cashReason: 'other', cashReasonNote: 'x'.repeat(501) }))).not.toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement**

```ts
// app/refund-requests/dto/refund-requests.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, ValidateNested } from 'class-validator';
import { RefundCashReason, RefundMethod } from '../../../entities/refund-request.entity';
import { REFUND_BANKS } from '../refund-banks';

const parseJson = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
};

export class ReturnItemDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() orderItemId: string;
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) quantity: number;
}

export class CreateReturnDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() orderId: string;
  @ApiProperty() @IsString() @MaxLength(1000) reason: string;
  @ApiProperty({ type: [ReturnItemDto], description: 'multipart: JSON string' })
  @Transform(parseJson) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => ReturnItemDto)
  items: ReturnItemDto[];
}

export class CreateBankAccountDto {
  @ApiProperty({ enum: REFUND_BANKS.map((b) => b.code) }) @IsIn(REFUND_BANKS.map((b) => b.code)) bankCode: string;
  @ApiProperty() @IsString() @MaxLength(20) accountNumber: string;
  @ApiProperty() @IsString() @MaxLength(150) holderName: string;
  @ApiPropertyOptional() @IsOptional() @Transform(({ value }) => value === true || value === 'true') @IsBoolean() save: boolean = false;
}

export class ChooseMethodDto {
  @ApiProperty({ enum: RefundMethod }) @IsEnum(RefundMethod) method: RefundMethod;
  @ApiPropertyOptional({ enum: RefundCashReason }) @IsOptional() @IsEnum(RefundCashReason) cashReason?: RefundCashReason;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) cashReasonNote?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() bankAccountId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) policyVersion?: string;
}
```

```ts
// app/refund-requests/refund-requests.controller.ts
import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UploadedFiles, UseGuards, ValidationPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { HybridAuthGuard } from '../../shared/common/utils/auth.guard';
import { UploadMultipleFields } from '../interceptors/ile-upload.interceptor';
import { ChooseMethodDto, CreateBankAccountDto, CreateReturnDto } from './dto/refund-requests.dto';
import { RefundRequestsService } from './refund-requests.service';

type AuthRequest = { user?: { sub?: string } };
const IMAGE = /\.(jpg|jpeg|png)$/i;
const TMP = './uploads/refund-requests';
const v = new ValidationPipe({ transform: true, whitelist: true });
const uid = (req: AuthRequest) => {
  if (!req.user?.sub) throw new BadRequestException('ต้องเข้าสู่ระบบ');
  return req.user.sub;
};

@ApiTags('Refund Requests')
@ApiBearerAuth('bearer')
@UseGuards(HybridAuthGuard)
@Controller('refund-requests')
export class RefundRequestsController {
  constructor(private readonly refunds: RefundRequestsService) {}

  @Get('banks') banks() { return this.refunds.banks(); }

  @Get('policy') policy(@Query('lang') lang?: string) { return this.refunds.policy(lang === 'en' ? 'en' : 'th'); }

  @Get('bank-accounts') bankAccounts(@Req() req: AuthRequest) { return this.refunds.listBankAccounts(uid(req)); }

  @Post('bank-accounts')
  @ApiConsumes('multipart/form-data')
  @UploadMultipleFields([{ name: 'bookbank', maxCount: 1 }], TMP, 10, IMAGE)
  createBankAccount(@Req() req: AuthRequest, @Body(v) dto: CreateBankAccountDto, @UploadedFiles() files: { bookbank?: Express.Multer.File[] }) {
    return this.refunds.createBankAccount(uid(req), dto, files?.bookbank?.[0]);
  }

  @Get('orders/:orderId/returnable-items')
  returnable(@Req() req: AuthRequest, @Param('orderId', ParseUUIDPipe) orderId: string) {
    return this.refunds.getReturnableItems(uid(req), orderId);
  }

  @Post()
  @ApiConsumes('multipart/form-data')
  @UploadMultipleFields([{ name: 'evidence', maxCount: 5 }], TMP, 10, IMAGE)
  createReturn(@Req() req: AuthRequest, @Body(v) dto: CreateReturnDto, @UploadedFiles() files: { evidence?: Express.Multer.File[] }) {
    return this.refunds.createReturn(uid(req), dto, files?.evidence ?? []);
  }

  @Get() list(@Req() req: AuthRequest, @Query('orderId') orderId?: string) { return this.refunds.list(uid(req), orderId); }

  @Get(':id') detail(@Req() req: AuthRequest, @Param('id', ParseUUIDPipe) id: string) { return this.refunds.getDetail(uid(req), id); }

  @Post(':id/method')
  chooseMethod(@Req() req: AuthRequest, @Param('id', ParseUUIDPipe) id: string, @Body(v) dto: ChooseMethodDto) {
    return this.refunds.chooseMethod(uid(req), id, dto);
  }
}
```

```ts
// app/refund-requests/refund-requests.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RefundRequest } from '../../entities/refund-request.entity';
import { RefundRequestItem } from '../../entities/refund-request-item.entity';
import { RefundBankAccount } from '../../entities/refund-bank-account.entity';
import { HybridAuthGuard } from '../../shared/common/utils/auth.guard';
import { RefundRequestsController } from './refund-requests.controller';
import { RefundRequestsService } from './refund-requests.service';
import { RefundNotifier } from './refund-notifier';

@Module({
  imports: [TypeOrmModule.forFeature([RefundRequest, RefundRequestItem, RefundBankAccount])],
  controllers: [RefundRequestsController],
  providers: [RefundRequestsService, RefundNotifier, HybridAuthGuard],
  exports: [RefundRequestsService],
})
export class RefundRequestsModule {}
```

Copy the module imports that `CreditNoteModule` / `KycModule` use to get `MediaStorageService`, `HybridAuthGuard` dependencies (JWT, user repo) and the notification module. Check `app/kyc/kyc.module.ts` and add the same entries to `imports`. Register `RefundRequestsModule` in `app/app.module.ts` next to `CreditBackModule`.

Make sure `./uploads/refund-requests` exists at runtime. `KYC_UPLOAD_DESTINATION` shows how KYC does it; reuse the same mechanism, for example `mkdirSync(TMP, { recursive: true })` at module load if that is what kyc does.

- [ ] **Step 4: Run tests + typecheck**

Run: `npx nx test backend -- apps/backend/src/app/refund-requests` → PASS
Run: `npx tsc -p apps/backend/tsconfig.app.json --noEmit` → no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/app/refund-requests apps/backend/src/app/app.module.ts
git commit -m "feat(refund): customer refund-requests API"
```

---

### Task 9: Admin service + controller — approve, payout, transfer, reject, changes, retry, resolve

**Files:**
- Create: `app/refund-requests/refund-requests-admin.service.ts`
- Create: `app/refund-requests/refund-card-payout.service.ts`
- Create: `app/refund-requests/refund-requests-admin.controller.ts`
- Modify: `app/refund-requests/refund-requests.module.ts`
  - Add the controller and providers.
  - Import `CreditNoteModule` (exports `CreditNoteService`), the KBank provider (`KbankApiClient`, check `payment.module.ts` exports) and `AdminWriteGuard` deps (`HybridAuthGuard`, `InternalAuthGuard`).
- Test: `app/refund-requests/refund-card-payout.service.spec.ts`
- Test: `app/refund-requests/refund-requests-admin.service.spec.ts`

**Interfaces:**
- Consumes:
  - `CreditNoteService.issueCreditNote` / `notifyIssued` (Task 5).
  - `CreditBackService.notifyIssued` (existing).
  - `KbankApiClient.voidCharge` / `refundCharge`, `KbankHttpError`, `KbankNetworkError` (Task 4).
  - `loadPaidCharge`, `loadOrderMoney`, `refundedBeforeOnCharge` (Task 7).
  - `splitCashCredit`, `decideCardAction`, `kbankTransactionDate`, `toExVat` (Task 2).
  - `decryptPii` (Task 3).
- Produces:
  - `RefundCardPayoutService.execute(requestId: string): Promise<RefundRequest>`
  - `RefundRequestsAdminService` methods:
    - `list(q: { status?: string; source?: string; page?: number })`
    - `detail(id)`
    - `approve(id, by: string | null, note?: string)`
    - `reject(id, reason, by)`
    - `requestChanges(id, reason, by)`
    - `markTransferred(id, input: { amount: number; transferredAt: Date }, slip: Express.Multer.File, by)`
    - `retry(id, by)`
    - `resolve(id, outcome: 'completed' | 'failed', note, by)`
  - Routes, all under `@UseGuards(AdminWriteGuard)` at `@Controller('admin/refund-requests')`:
    - `GET /`
    - `GET /:id`
    - `PATCH /:id/approve`
    - `PATCH /:id/reject`
    - `PATCH /:id/request-changes`
    - `POST /:id/transfer` (multipart `slip`, `transferredAmount`, `transferredAt`)
    - `PATCH /:id/retry`
    - `PATCH /:id/resolve`

**State machine (enforced in each method, with the row locked `FOR UPDATE`):**

| From | Action | To |
|---|---|---|
| under_review | approve, method credit | completed |
| under_review | approve, method card | processing (gateway pending) → completed / failed / processing+unknown |
| under_review | approve, method bank_transfer | awaiting_transfer |
| awaiting_method, under_review, changes_requested (**return only**) | reject | rejected |
| under_review, failed | request-changes | changes_requested (method, bank account and policy cleared; weight-diff CB `paid_out` → `held`) |
| awaiting_transfer | transfer | completed |
| failed | retry | processing → (same as approve-card result) |
| processing with gateway_status=unknown | resolve | completed / failed |

Any other combination → `BadRequestException('สถานะเปลี่ยนไปแล้ว กรุณารีเฟรช')`. A weight-diff request cannot be rejected, because the money is owed. Use request-changes instead.

**Approve details:**
1. In the transaction:
   - Lock the request and its order.
   - Load `charge` and `money` (excluding this request).
   - For weight diff: lock the CB (`SELECT … FOR UPDATE`). It must be `held`, and `toIncVat(cb.total_amount)` must equal `amount_inc_vat`. Otherwise sync `amount_inc_vat` and throw `BadRequestException('ยอดส่วนต่างน้ำหนักเปลี่ยน กรุณารีเฟรช')`.
2. Credit:
   - Return: `issueCreditNote(manager, { order, amountExVat: toExVat(amount), reason: 'คืนสินค้า ' + refund_number, cnNumber: 'CN-' + refund_number })`.
   - Weight diff: CB → `active`.
   - Set `credit_amount_inc_vat = amount`, `cash_amount_inc_vat = 0`, `refund_to_label = cn_number | cb_number`, status `completed`, `completed_at`.
3. Card / bank:
   - `split = splitCashCredit(...)`. If `cashIncVat <= 0` → `BadRequestException('ไม่มียอดเงินสดให้คืนแล้ว')`.
   - Return: if `creditIncVat > 0`, issue the CN for the credit part now.
   - Weight diff: CB → `paid_out`, `remaining_amount = 0`.
4. Card: set
   - `payment_transaction_id = charge.id`
   - `gateway_action = decideCardAction({ chargeAmount: charge.chargeAmount, refundAmount: split.cashIncVat, refundedBeforeOnCharge: await refundedBeforeOnCharge(manager, charge.id, r.id) })`
   - `gateway_status = pending`, status `processing`, `refund_to_label = refundToLabelFor(...)`

   Bank: status `awaiting_transfer`, label from the bank account.
5. Set `approved_at`, `approved_by` and commit. **After commit:** for card, `await payout.execute(id)`. Then notify (Task 11), and run the CN/CB `notifyIssued` for any credit issued.

**Payout (`RefundCardPayoutService.execute`):**

```ts
// app/refund-requests/refund-card-payout.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { PaymentTransaction } from '../../entities/payment-transaction.entity';
import { RefundGatewayAction, RefundGatewayStatus, RefundRequest, RefundRequestStatus } from '../../entities/refund-request.entity';
import { KbankApiClient, KbankHttpError, KbankNetworkError } from '../payment/kbank/kbank-api.client';
import { kbankTransactionDate } from './refund-methods.helper';

@Injectable()
export class RefundCardPayoutService {
  private readonly logger = new Logger(RefundCardPayoutService.name);
  constructor(@InjectDataSource() private readonly dataSource: DataSource, private readonly kbank: KbankApiClient) {}

  /**
   * Calls KBank OUTSIDE any transaction (row is already `processing` + gateway `pending`), then records the result.
   * Void rejected by KBank (definite answer, e.g. settled) → refund the full amount once.
   * Network error → `unknown`: an admin checks the KBank portal and resolves; never retried automatically.
   */
  async execute(requestId: string): Promise<RefundRequest> {
    const repo = this.dataSource.getRepository(RefundRequest);
    const r = await repo.findOneOrFail({ where: { id: requestId } });
    if (r.status !== RefundRequestStatus.PROCESSING || r.gateway_status !== RefundGatewayStatus.PENDING) return r;
    const txn = await this.dataSource.getRepository(PaymentTransaction).findOneOrFail({ where: { id: r.payment_transaction_id! } });
    const amount = Number(r.cash_amount_inc_vat);
    const reason = `refund ${r.refund_number}`;
    const refund = () => this.kbank.refundCharge({
      chargeId: txn.gateway_charge_id!, amount, reason,
      transactionDate: txn.paid_at ? kbankTransactionDate(new Date(txn.paid_at), new Date()) : undefined,
    });
    let action = r.gateway_action!;
    let result: { status: RefundGatewayStatus; response: Record<string, unknown> };
    try {
      let response: Record<string, unknown>;
      if (action === RefundGatewayAction.VOID) {
        try {
          response = await this.kbank.voidCharge(txn.gateway_charge_id!, reason);
        } catch (err) {
          if (!(err instanceof KbankHttpError)) throw err;
          this.logger.warn(`void refused for ${r.refund_number} (${err.code ?? err.httpStatus}) → refund full`);
          action = RefundGatewayAction.REFUND;
          response = await refund();
        }
      } else {
        response = await refund();
      }
      result = { status: RefundGatewayStatus.SUCCESS, response };
    } catch (err) {
      if (err instanceof KbankNetworkError) {
        result = { status: RefundGatewayStatus.UNKNOWN, response: { error: 'network', message: err.message } };
      } else if (err instanceof KbankHttpError) {
        result = { status: RefundGatewayStatus.FAILED, response: { error: 'http', httpStatus: err.httpStatus, code: err.code, message: err.message } };
      } else {
        result = { status: RefundGatewayStatus.UNKNOWN, response: { error: 'unexpected', message: String(err) } };
      }
    }
    Object.assign(r, {
      gateway_action: action,
      gateway_status: result.status,
      gateway_response: result.response,
      ...(result.status === RefundGatewayStatus.SUCCESS ? { status: RefundRequestStatus.COMPLETED, completed_at: new Date() } : {}),
      ...(result.status === RefundGatewayStatus.FAILED ? { status: RefundRequestStatus.FAILED } : {}),
    });
    return repo.save(r);
  }
}
```

- [ ] **Step 1: Write the failing payout tests**

```ts
// app/refund-requests/refund-card-payout.service.spec.ts
import { RefundCardPayoutService } from './refund-card-payout.service';
import { KbankHttpError, KbankNetworkError } from '../payment/kbank/kbank-api.client';
import { RefundGatewayAction, RefundGatewayStatus, RefundRequestStatus } from '../../entities/refund-request.entity';

function setup(action: RefundGatewayAction, kbank: Partial<Record<'voidCharge' | 'refundCharge', jest.Mock>>) {
  const row = {
    id: 'rr1', refund_number: 'RF2026000001', status: RefundRequestStatus.PROCESSING, gateway_status: RefundGatewayStatus.PENDING,
    gateway_action: action, payment_transaction_id: 't1', cash_amount_inc_vat: 1000,
  };
  const save = jest.fn(async (r) => r);
  const ds = {
    getRepository: jest.fn((e: { name: string }) => e.name === 'RefundRequest'
      ? { findOneOrFail: async () => ({ ...row }), save }
      : { findOneOrFail: async () => ({ id: 't1', gateway_charge_id: 'chrg_1', paid_at: new Date() }) }),
  };
  const client = { voidCharge: jest.fn(), refundCharge: jest.fn(), ...kbank };
  return { svc: new RefundCardPayoutService(ds as never, client as never), save, client };
}

describe('RefundCardPayoutService', () => {
  it('void success → completed', async () => {
    const { svc, client } = setup(RefundGatewayAction.VOID, { voidCharge: jest.fn(async () => ({ id: 'chrg_1' })) });
    const r = await svc.execute('rr1');
    expect(r).toMatchObject({ status: RefundRequestStatus.COMPLETED, gateway_status: RefundGatewayStatus.SUCCESS, gateway_action: RefundGatewayAction.VOID });
    expect(client.refundCharge).not.toHaveBeenCalled();
  });

  it('void refused by KBank → full refund once → completed as refund', async () => {
    const { svc, client } = setup(RefundGatewayAction.VOID, {
      voidCharge: jest.fn(async () => { throw new KbankHttpError(400, 'already_settled', 'settled'); }),
      refundCharge: jest.fn(async () => ({ id: 'chrg_1' })),
    });
    const r = await svc.execute('rr1');
    expect(client.refundCharge).toHaveBeenCalledWith(expect.objectContaining({ chargeId: 'chrg_1', amount: 1000 }));
    expect(r).toMatchObject({ status: RefundRequestStatus.COMPLETED, gateway_action: RefundGatewayAction.REFUND });
  });

  it('REVIEW FOCUS 1: network error on void → unknown, stays processing, NO refund fallback', async () => {
    const { svc, client } = setup(RefundGatewayAction.VOID, { voidCharge: jest.fn(async () => { throw new KbankNetworkError(); }) });
    const r = await svc.execute('rr1');
    expect(r).toMatchObject({ status: RefundRequestStatus.PROCESSING, gateway_status: RefundGatewayStatus.UNKNOWN });
    expect(client.refundCharge).not.toHaveBeenCalled();
  });

  it('refund refused → failed', async () => {
    const { svc } = setup(RefundGatewayAction.REFUND, { refundCharge: jest.fn(async () => { throw new KbankHttpError(422, 'x', 'nope'); }) });
    expect(await svc.execute('rr1')).toMatchObject({ status: RefundRequestStatus.FAILED, gateway_status: RefundGatewayStatus.FAILED });
  });

  it('does nothing unless processing + pending (no double call)', async () => {
    const { svc, client } = setup(RefundGatewayAction.VOID, { voidCharge: jest.fn() });
    const repo = (svc as unknown as { dataSource: { getRepository: jest.Mock } }).dataSource.getRepository;
    repo.mockImplementationOnce(() => ({ findOneOrFail: async () => ({ status: RefundRequestStatus.COMPLETED, gateway_status: RefundGatewayStatus.SUCCESS }), save: jest.fn() }));
    await svc.execute('rr1');
    expect(client.voidCharge).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Write the failing admin-service tests** in `refund-requests-admin.service.spec.ts`, using the same `Object.create(...prototype)` plus a mocked `dataSource.transaction`. Cover these cases:
  - **REVIEW FOCUS 3:** `approve` on a row whose locked status is already `processing` → `BadRequestException('สถานะเปลี่ยนไปแล้ว กรุณารีเฟรช')`, and `payout.execute` is not called.
  - Approve credit on a return → `issueCreditNote` is called with `amountExVat = toExVat(amount)` and `cnNumber = 'CN-RF…'`. Status is `completed`, `refund_to_label = cn_number`.
  - Approve card on a return where `split = {cash: 700, credit: 200}` → CN for 200 (ex VAT 186.92), `cash_amount_inc_vat = 700`, status `processing`, then `payout.execute` is called once after commit.
  - Approve on weight diff where the CB is no longer `held` → BadRequest. Approve bank on weight diff → CB is saved `paid_out`, `remaining_amount = 0`.
  - `reject` on weight diff → BadRequest. `reject` on a return under_review → `rejected`, `reject_reason`, `rejected_at`.
  - `requestChanges` from `failed` on weight diff → CB `paid_out` → `held` with `remaining_amount = total_amount`, and the request has method/bank/policy cleared.
  - `markTransferred` with an amount ≠ `cash_amount_inc_vat` (±0.01) → BadRequest. A matching amount → `completed`, with `transfer_slip_key`, `transferred_amount`, `transferred_at`.
  - `resolve` only when `processing` + `unknown`.
  - `detail` returns `accountNumber` decrypted and signed URLs for evidence, bookbank and slip (mock `getPrivateSignedUrl`).

- [ ] **Step 3: Run to verify failures, then implement** `refund-requests-admin.service.ts` following the table and approve details above. Then implement `refund-requests-admin.controller.ts`, mirroring the customer controller:
  - Guard: `@UseGuards(AdminWriteGuard)`.
  - `approved_by` comes from `req.user?.sub ?? null`.
  - The `transfer` route uses `UploadMultipleFields([{ name: 'slip', maxCount: 1 }], TMP, 10, /\.(jpg|jpeg|png|pdf)$/i)`.
  - Add DTOs to `dto/refund-requests.dto.ts`: `RejectRefundDto { @IsString() @MaxLength(1000) reason }`, `RequestChangesDto` (same shape), `ApproveRefundDto { @IsOptional() @IsString() @MaxLength(1000) note? }`, `MarkTransferredDto { @Type(() => Number) @IsNumber() @Min(0.01) transferredAmount; @Type(() => Date) @IsDate() transferredAt }`, `ResolveRefundDto { @IsIn(['completed','failed']) outcome; @IsString() @MaxLength(1000) note }`.
  - Admin list query: `status?` (IsIn statuses), `source?`, `page?` (Int ≥1). Return 50 per page sorted `created_at ASC`, with `{ items, total, page }`. Each item: `refundRequestId, refundNumber, orderId, orderNumber, source, status, method, amountIncVat, cashAmountIncVat, createdAt, approvedAt, gatewayStatus`.

- [ ] **Step 4: Run** `npx nx test backend -- apps/backend/src/app/refund-requests` → PASS. Then run `npx tsc -p apps/backend/tsconfig.app.json --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/app/refund-requests
git commit -m "feat(refund): admin approval, KBank void/refund payout, bank transfer completion"
```

---

### Task 10: Weight-diff sync cron

**Files:**
- Create: `app/refund-requests/refund-weight-diff.cron.ts`
- Modify: `config/cron.config.ts` (add `refundWeightDiffSync` to `CronConfig` and the builder: `envCron('CRON_REFUND_WEIGHT_DIFF_SYNC', '0 */5 * * * *', env)`, `cronEnabled('CRON_REFUND_WEIGHT_DIFF_SYNC_ENABLED', env)`)
- Modify: `app/refund-requests/refund-requests.module.ts` (provider; import the cron-lock module the same way `cache-warmup` does)
- Test: `app/refund-requests/refund-weight-diff.cron.spec.ts`

**Interfaces:**
- Consumes: `isRefundFlowEnabled`, `CronLockService.withLock(key, ttlSeconds, fn)`, `DEFAULT_VAT_RATE`, `RefundNotifier`.
- Produces: `RefundWeightDiffCron.sync(): Promise<{ opened: string[]; updated: number; cancelled: number; defaulted: number }>`.

```ts
// app/refund-requests/refund-weight-diff.cron.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { cronConfig } from '../../config/cron.config';
import { CronLockService } from '../../shared/cron-lock/cron-lock.service';
import { DEFAULT_VAT_RATE } from '../../shared/constants/checkout.constants';
import { isRefundFlowEnabled } from './refund-flow.flag';
import { RefundNotifier } from './refund-notifier';

const OPEN = `('awaiting_method','under_review','changes_requested')`;

/**
 * Keeps weight-diff refund requests in step with held Credit Backs (ERP owns the CB amount):
 * open one per new held CB, follow amount changes, cancel when ERP cancelled the CB, and after 7 days
 * without a choice pick credit (decision 3 — the admin still approves). Approve re-checks the CB under lock,
 * so the ≤5-minute lag is harmless.
 */
@Injectable()
export class RefundWeightDiffCron {
  private readonly logger = new Logger(RefundWeightDiffCron.name);
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly cronLock: CronLockService,
    private readonly notifier: RefundNotifier,
  ) {}

  @Cron(cronConfig.refundWeightDiffSync.expression, {
    timeZone: cronConfig.refundWeightDiffSync.timeZone,
    disabled: !cronConfig.refundWeightDiffSync.enabled,
  })
  async run(): Promise<void> {
    if (!isRefundFlowEnabled()) return;
    await this.cronLock.withLock('refund-weight-diff-sync', 240, async () => {
      const r = await this.sync();
      if (r.opened.length || r.updated || r.cancelled || r.defaulted) this.logger.log(`weight-diff sync ${JSON.stringify({ ...r, opened: r.opened.length })}`);
    });
  }

  async sync() {
    const vat = 1 + DEFAULT_VAT_RATE;
    const result = await this.dataSource.transaction(async (m) => {
      const opened: Array<{ id: string }> = await m.query(
        `INSERT INTO refund_requests (order_id, source, status, reason, amount_inc_vat, credit_back_id)
         SELECT cb.issued_from_order_id, 'weight_diff', 'awaiting_method', 'weight_adjustment', ROUND(cb.total_amount * $1, 2), cb.cb_id
           FROM credit_backs cb
          WHERE cb.cb_status = 'held' AND cb.source = 'invoice_delta' AND cb.total_amount > 0
            AND NOT EXISTS (SELECT 1 FROM refund_requests rr WHERE rr.credit_back_id = cb.cb_id)
         ON CONFLICT (credit_back_id) WHERE credit_back_id IS NOT NULL DO NOTHING
         RETURNING id`, [vat]);
      const [, updated] = await m.query(
        `UPDATE refund_requests rr SET amount_inc_vat = ROUND(cb.total_amount * $1, 2), updated_at = now()
           FROM credit_backs cb
          WHERE rr.credit_back_id = cb.cb_id AND rr.status IN ${OPEN} AND cb.cb_status = 'held'
            AND rr.amount_inc_vat <> ROUND(cb.total_amount * $1, 2)`, [vat]);
      const [, cancelled] = await m.query(
        `UPDATE refund_requests rr SET status = 'cancelled', cancelled_at = now(), updated_at = now()
           FROM credit_backs cb
          WHERE rr.credit_back_id = cb.cb_id AND rr.status IN ${OPEN} AND cb.cb_status = 'cancelled'`);
      const [, defaulted] = await m.query(
        `UPDATE refund_requests SET method = 'credit', status = 'under_review', method_chosen_at = now(), updated_at = now()
          WHERE source = 'weight_diff' AND status = 'awaiting_method' AND created_at < now() - interval '7 days'`);
      return { opened: opened.map((o) => o.id), updated: Number(updated ?? 0), cancelled: Number(cancelled ?? 0), defaulted: Number(defaulted ?? 0) };
    });
    for (const id of result.opened) await this.notifier.notifyById(id);
    return result;
  }
}
```

- [ ] **Step 1: Write the failing test.** Mock `dataSource.transaction` with a manager whose `query` returns, in order: `[{id:'rr1'}]`, `[[], 2]`, `[[], 1]`, `[[], 0]`. Assert:
  - `sync()` returns `{ opened: ['rr1'], updated: 2, cancelled: 1, defaulted: 0 }`.
  - `notifier.notifyById` is called with `'rr1'` after the transaction.
  - The first SQL contains `cb.cb_status = 'held'` and `ON CONFLICT (credit_back_id)`.
  - `run()` with the flag off never calls `withLock`.

  Note that the TypeORM Postgres driver returns `[rows, affected]` for UPDATE `query()`. If the josh TypeORM version returns rows only, switch the three UPDATEs to `RETURNING id` and count rows. Check how existing code counts UPDATE results (`git grep -n "affected" origin/main -- apps/backend/src/app | head`).

- [ ] **Step 2: Run → FAIL. Step 3: Implement (code above) + cron config entry. Step 4: Run → PASS.**

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/app/refund-requests apps/backend/src/config/cron.config.ts
git commit -m "feat(refund): weight-diff refund request sync cron (flagged)"
```

---

### Task 11: Notifications

**Files:**
- Modify: `app/refund-requests/refund-notifier.ts` (replace the stub from Task 7)
- Modify: `app/notification/notification-catalog.ts` (new entry after `credit_back_cancelled`)
- Modify: `app/notification/templates/notification-templates.ts` (new template)
- Modify: `app/notification/notification-link.ts` (add `'refund_request'` to the target union, plus a branch)
- Modify: `docs/notification-catalog.md`
- Modify: `refund-requests.service.ts` / `refund-requests-admin.service.ts` (call `notifier.notifyById(id)` after commit in: `chooseMethod` no; admin `approve` yes, `reject` yes, `requestChanges` yes, `markTransferred` yes, `resolve` yes; payout result yes)
- Test: `app/refund-requests/refund-notifier.spec.ts`
- Test: `app/notification/templates/refund-request-template.spec.ts`

**Interfaces:**
- Produces: `RefundNotifier.notifyById(id: string): Promise<void>`. It never throws. It dispatches `type: 'refund_request_updated'`, `category: 'financial'`, `data: { refund_request_id, refund_number, status, amount, order_id, order_number }`, `dedupeKey: refund_request:${id}:${status}`.
- It only sends for statuses `awaiting_method`, `changes_requested`, `completed` and `rejected`. Everything else is internal and returns early.

```ts
// app/refund-requests/refund-notifier.ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { RefundRequest, RefundRequestStatus } from '../../entities/refund-request.entity';
import { User } from '../../entities/user.entity';
import { NotificationService } from '../notification/notification.service';
import { resolveOrderLocale } from '../orders/order-locale.helper';

const CUSTOMER_FACING = new Set<string>([
  RefundRequestStatus.AWAITING_METHOD, RefundRequestStatus.CHANGES_REQUESTED, RefundRequestStatus.COMPLETED, RefundRequestStatus.REJECTED,
]);

@Injectable()
export class RefundNotifier {
  private readonly logger = new Logger(RefundNotifier.name);
  constructor(@InjectDataSource() private readonly dataSource: DataSource, private readonly notifications: NotificationService) {}

  /** Call AFTER commit. Never throws. */
  async notifyById(id: string): Promise<void> {
    try {
      const r = await this.dataSource.getRepository(RefundRequest).findOne({ where: { id }, relations: ['order'] });
      if (!r || !CUSTOMER_FACING.has(r.status) || !r.order?.user_id) return;
      const user = await this.dataSource.getRepository(User).findOne({ where: { id: r.order.user_id } });
      await this.notifications.dispatch({
        userId: r.order.user_id,
        locale: resolveOrderLocale(user?.preferred_language),
        type: 'refund_request_updated',
        category: 'financial',
        data: {
          refund_request_id: r.id, refund_number: r.refund_number, status: r.status, source: r.source,
          amount: Number(r.amount_inc_vat), order_id: r.order_id, order_number: r.order.order_number,
        },
        dedupeKey: `refund_request:${r.id}:${r.status}`,
      });
    } catch (err) {
      this.logger.warn(`refund_request_updated notify failed for ${id}: ${String(err)}`);
    }
  }
}
```

Find the real import path of `resolveOrderLocale`. `credit-back.service.ts` imports it, so copy that import line.

Catalog entry:

```ts
  {
    type: 'refund_request_updated',
    category: 'financial',
    label: 'อัปเดตคำขอคืนเงิน',
    trigger: 'คำขอคืนเงินรอเลือกวิธีรับเงิน / ขอข้อมูลเพิ่ม / คืนเงินสำเร็จ / ถูกปฏิเสธ → แจ้งคนสั่งออเดอร์',
    critical: true,
  },
```

Template:

```ts
  refund_request_updated: (data, locale) => {
    const amount = money(data, 'amount');
    const order = orderNumber(data);
    const status = String(data?.status ?? '');
    const en: Record<string, { title: string; body: string }> = {
      awaiting_method: { title: 'Choose how to get your refund', body: `${amount} from order #${order} is ready — pick credit or money back.` },
      changes_requested: { title: 'We need more information', body: `Please update your refund request for order #${order}.` },
      completed: { title: 'Refund completed', body: `${amount} for order #${order} has been refunded.` },
      rejected: { title: 'Refund request declined', body: `Your refund request for order #${order} was declined.` },
    };
    const th: Record<string, { title: string; body: string }> = {
      awaiting_method: { title: 'เลือกวิธีรับเงินคืน', body: `ยอด ${amount} จากคำสั่งซื้อ #${order} พร้อมคืนแล้ว เลือกรับเป็นเครดิตหรือเงินคืน` },
      changes_requested: { title: 'ขอข้อมูลเพิ่มเติม', body: `กรุณาแก้ไขคำขอคืนเงินของคำสั่งซื้อ #${order}` },
      completed: { title: 'คืนเงินสำเร็จ', body: `คืนเงิน ${amount} ของคำสั่งซื้อ #${order} เรียบร้อยแล้ว` },
      rejected: { title: 'คำขอคืนเงินไม่ได้รับการอนุมัติ', body: `คำขอคืนเงินของคำสั่งซื้อ #${order} ไม่ได้รับการอนุมัติ` },
    };
    return (locale === 'en' ? en : th)[status] ?? (locale === 'en' ? en.completed : th.completed);
  },
```

Link branch (put it before the credit-note branch):

```ts
  if (type === 'refund_request_updated') {
    const id = pick(data, 'refund_request_id');
    if (id) return { target: 'refund_request', id, path: `/orders/${pick(data, 'order_id') ?? ''}` };
  }
```

- [ ] **Step 1: Write the failing tests**
  - The template returns the TH/EN texts above for each of the 4 statuses (`expect(templates.refund_request_updated({ status: 'completed', amount: 300, order_number: 'SO1' }, 'th').title).toBe('คืนเงินสำเร็จ')`).
  - The link resolves `target: 'refund_request'`.
  - The notifier skips `processing` and swallows dispatch errors.
  - If there is a catalog spec that checks every type has a template, it now covers the new type. Run it.
- [ ] **Step 2: Run → FAIL. Step 3: Implement. Step 4: Run** `npx nx test backend -- apps/backend/src/app/notification apps/backend/src/app/refund-requests` → PASS.
- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/app/notification apps/backend/src/app/refund-requests docs/notification-catalog.md
git commit -m "feat(refund): refund_request_updated notification"
```

---

### Task 12: Admin relay routes + API doc

**Files:**
- Modify: `app/erp/commerce-admin-relay.controller.ts` (`RELAY_ROUTES`, finance block ~line 92)
- Test: the existing relay spec next to it (find it with `git grep -ln RELAY_ROUTES origin/main -- apps/backend/src/**/*.spec.ts`)
- Create: `docs/refund-requests-api.md`
- Modify: `docs/api-naming-glossary.md` (add refund terms: `refundRequestId`, `amountIncVat`, `displayStatus`, `refundTo`)

- [ ] **Step 1: Write the failing relay spec cases.** These must be allowed:
  - `GET /admin/refund-requests`
  - `GET /admin/refund-requests/<uuid>`
  - `PATCH /admin/refund-requests/<uuid>/(approve|reject|request-changes|retry|resolve)`
  - `POST /admin/refund-requests/<uuid>/transfer`

  These must be refused: `DELETE /admin/refund-requests/<uuid>` and `GET /admin/refund-requests/<uuid>/anything-else`.

- [ ] **Step 2: Run → FAIL. Step 3: Add the routes**

```ts
  // finance: refund requests (new refund flow) — queue, approve/payout, bank-transfer completion
  { area: 'finance', methods: ['GET'], path: new RegExp(`^/admin/refund-requests(/${ID})?$`) },
  { area: 'finance', methods: ['PATCH'], path: new RegExp(`^/admin/refund-requests/${ID}/(approve|reject|request-changes|retry|resolve)$`) },
  { area: 'finance', methods: ['POST'], path: new RegExp(`^/admin/refund-requests/${ID}/transfer$`) },
```

- [ ] **Step 4: Write `docs/refund-requests-api.md`** in the house style (`josh-docs-style` skill). It must include:
  - Overview and status table (the state machine from Task 9).
  - Every customer and admin route with request and response examples taken from the service code.
  - Upload limits.
  - The void/refund rule table.
  - The `REFUND_FLOW_ENABLED`, `REFUND_PII_KEY`, `CRON_REFUND_WEIGHT_DIFF_SYNC*` env.
  - Rollout steps: run the migration → set `REFUND_PII_KEY` → deploy → test in the KBank sandbox → only then `REFUND_FLOW_ENABLED=true`.
- [ ] **Step 5: Run the relay spec → PASS, then commit**

```bash
git add apps/backend/src/app/erp docs/refund-requests-api.md docs/api-naming-glossary.md
git commit -m "feat(refund): relay admin refund routes for commerce-admin; API doc"
```

---

### Task 13 (commerce-platform): allow the routes in the admin-call relay

**Files:**
- Modify: `apps/commerce-platform/src/modules/integration/connector/josh/josh-admin-call.controller.ts` (`AREAS`, next to the `credit-notes|credit-backs` entries ~line 56–57)
- Test: `apps/commerce-platform/src/modules/integration/connector/josh/josh-admin-call.controller.spec.ts`

- [ ] **Step 1: Write the failing spec**, following the existing `CS_REFUSED` / `CS_UI_CALLS` tables:

```ts
  const U = '6f1c1d2e-0000-4000-8000-000000000001';
  const REFUND_ADMIN_CALLS: [string, string][] = [
    ['GET', '/admin/refund-requests'],
    ['GET', `/admin/refund-requests/${U}`],
    ['PATCH', `/admin/refund-requests/${U}/approve`],
    ['PATCH', `/admin/refund-requests/${U}/reject`],
    ['PATCH', `/admin/refund-requests/${U}/request-changes`],
    ['PATCH', `/admin/refund-requests/${U}/retry`],
    ['PATCH', `/admin/refund-requests/${U}/resolve`],
  ];
  it('refund requests: admin only (decision 9 — bank details are PII)', async () => {
    for (const [method, path] of REFUND_ADMIN_CALLS) {
      await expect(c.call({ method, path }, req('cs'))).rejects.toThrow('admin only');
      await expect(c.call({ method, path }, req('admin'))).resolves.toBeDefined();
    }
  });
```

Build `c` and `req` the same way the spec's existing `describe` does.

- [ ] **Step 2: Run** `npx nx test commerce-platform --testFile=josh-admin-call.controller.spec.ts` → FAIL ("is not a josh admin route commerce drives").

- [ ] **Step 3: Add to `AREAS`** (before the `cs-admin/` catch-all):

```ts
  // refund requests (josh's new refund flow): admin only — bank account numbers and bookbank images are PII.
  { path: new RegExp(`^/admin/refund-requests(/${ID}(/(approve|reject|request-changes|retry|resolve|transfer))?)?$`), roles: ADMIN },
```

`POST …/transfer` goes through the existing `@Post('upload')` multipart path, so no other change is needed. That path is limited to 3.5 MB per save for base64 files on the JSON path, while real multipart uses the 60 MB upload route.

- [ ] **Step 4: Run → PASS. Commit.**

```bash
git add apps/commerce-platform/src/modules/integration/connector/josh/josh-admin-call.controller*
git commit -m "feat(josh-relay): allow josh refund-request admin routes (admin only)"
```

---

### Task 14 (commerce-admin): refund requests page

**Files:**
- Create: `apps/commerce-admin/src/josh-admin/libs/shared-api/lib/refund-request/refund-request.api.ts`
- Modify: `apps/commerce-admin/src/josh-admin/libs/shared-api/index.ts` (export it)
- Create: `apps/commerce-admin/src/josh-admin/app/page/CS/RefundRequestsAdmin.tsx`
- Create: `apps/commerce-admin/src/josh-admin/app/page/CS/RefundRequestsAdmin.spec.tsx`
- Modify: `apps/commerce-admin/src/josh-admin/JoshAdminApp.tsx` (lazy import + `<Route path="refund-requests" …>` next to `refunds` ~line 161)
- Modify: `apps/commerce-admin/src/josh-admin/app/config/admin-routes.ts` (`refundRequests: '/refund-requests'`, plus a Finance group entry ~line 320)
- Modify: `apps/commerce-admin/src/app/navigation.ts` (orders section ~line 61: `{ to: '/j/refund-requests', label: 'คำขอคืนเงิน', description: 'ตรวจหลักฐาน อนุมัติ และโอนคืนเงินลูกค้า' }`, **not** added to `ROLE_ACCESS`, so it is admin-only)

**Interfaces:**
- Consumes: the josh admin routes from Task 9 via `apiClient` (`josh-admin/libs/shared-api/lib/api-client/api-client.ts`). It sends FormData through `joshAdmin.upload` automatically.
- Produces:
  - `listRefundRequests(params)`
  - `getRefundRequest(id)`
  - `approveRefundRequest(id, note?)`
  - `rejectRefundRequest(id, reason)`
  - `requestRefundChanges(id, reason)`
  - `markRefundTransferred(id, { amount, transferredAt, slip })`
  - `retryRefundRequest(id)`
  - `resolveRefundRequest(id, outcome, note)`

```ts
// apps/commerce-admin/src/josh-admin/libs/shared-api/lib/refund-request/refund-request.api.ts
import { apiClient } from '../api-client/api-client';

export type RefundRequestStatus =
  | 'awaiting_method' | 'under_review' | 'changes_requested' | 'processing' | 'awaiting_transfer'
  | 'completed' | 'rejected' | 'failed' | 'cancelled';

export type RefundRequestRow = {
  refundRequestId: string; refundNumber: string; orderId: string; orderNumber: string | null;
  source: 'return' | 'weight_diff'; status: RefundRequestStatus; method: 'credit' | 'card' | 'bank_transfer' | null;
  amountIncVat: number; cashAmountIncVat: number | null; createdAt: string; approvedAt: string | null; gatewayStatus: string | null;
};

export type RefundRequestDetail = RefundRequestRow & {
  reason: string; items: { orderItemId: string; productName: string; sku: string | null; quantity: number; amountIncVat: number }[];
  evidenceUrls: string[]; cashReason: string | null; cashReasonNote: string | null;
  bankAccount: { bankCode: string; bankNameTh: string; accountNumber: string; holderName: string; bookbankUrl: string | null } | null;
  policyVersion: string | null; policyAcceptedAt: string | null; refundTo: string | null;
  creditAmountIncVat: number | null; gatewayAction: string | null; gatewayResponse: unknown;
  transferSlipUrl: string | null; transferredAmount: number | null; transferredAt: string | null;
  changesRequestedReason: string | null; rejectReason: string | null; adminNote: string | null;
};

type Envelope<T> = { data: T };
const base = '/admin/refund-requests';

export const listRefundRequests = (params: { status?: RefundRequestStatus; source?: string; page?: number }) =>
  apiClient.get<Envelope<{ items: RefundRequestRow[]; total: number; page: number }>>(base, { params });
export const getRefundRequest = (id: string) => apiClient.get<Envelope<RefundRequestDetail>>(`${base}/${id}`);
export const approveRefundRequest = (id: string, note?: string) => apiClient.patch(`${base}/${id}/approve`, { note });
export const rejectRefundRequest = (id: string, reason: string) => apiClient.patch(`${base}/${id}/reject`, { reason });
export const requestRefundChanges = (id: string, reason: string) => apiClient.patch(`${base}/${id}/request-changes`, { reason });
export const retryRefundRequest = (id: string) => apiClient.patch(`${base}/${id}/retry`, {});
export const resolveRefundRequest = (id: string, outcome: 'completed' | 'failed', note: string) =>
  apiClient.patch(`${base}/${id}/resolve`, { outcome, note });
export function markRefundTransferred(id: string, input: { amount: number; transferredAt: string; slip: File }) {
  const form = new FormData();
  form.append('transferredAmount', String(input.amount));
  form.append('transferredAt', input.transferredAt);
  form.append('slip', input.slip);
  return apiClient.post(`${base}/${id}/transfer`, form);
}
```

Match the exact response unwrapping used in `credit-back.api.ts` (`ApiSuccess<…>`) if it differs from `Envelope`. Also make Task 9's admin `detail` return exactly the `RefundRequestDetail` fields above.

**Page behaviour:**
- **Tabs by status**, defaulting to `under_review`:
  - รอตรวจ (under_review)
  - รอโอน (awaiting_transfer)
  - ต้องดูแล (failed + processing with gatewayStatus=unknown)
  - รอลูกค้า (awaiting_method + changes_requested)
  - เสร็จ (completed)
  - ทั้งหมด
- **Table:** refund number, order number, source (คืนสินค้า / ส่วนต่างน้ำหนัก), method, amount, created at.
- **Clicking a row** opens a detail panel with:
  - Items and evidence images (thumbnails, click to open full size).
  - Cash reason.
  - Bank block: bank name, full account number with a copy button, holder name, bookbank image, and the accepted policy version and time.
  - Gateway result.
- **Actions per status:**
  - under_review: อนุมัติ (confirm dialog showing method and amount), ขอข้อมูลเพิ่ม (reason required), ปฏิเสธ (reason required; hidden for weight_diff).
  - awaiting_transfer: บันทึกการโอน (amount prefilled with `cashAmountIncVat`, date, slip file required).
  - failed: ลองใหม่, ขอข้อมูลเพิ่ม.
  - processing + unknown: ทำเครื่องหมายว่าสำเร็จ / ล้มเหลว (note required). Show a warning: "ตรวจใน KBank portal ก่อน — ห้ามกดลองใหม่ถ้าไม่แน่ใจว่ายังไม่ได้คืน".
- **After any action:** refetch the detail and the list, and show the API error message on failure.

Copy the layout, table, tab and dialog components from `CreditBacksAdmin.tsx` / `RefundsAdmin.tsx` in the same folder, so the page matches the rest of josh-admin. Do not introduce a new UI library.

- [ ] **Step 1: Write the failing vitest spec.** Mock `refund-request.api`, render the page, and assert:
  - The under_review row shows อนุมัติ, and clicking confirm calls `approveRefundRequest(id, undefined)`.
  - A weight_diff row has no ปฏิเสธ button.
  - บันทึกการโอน is disabled until a slip file is chosen, then calls `markRefundTransferred` with the prefilled amount.
  - The unknown-gateway row shows the KBank warning and no ลองใหม่ button.
- [ ] **Step 2: Run** `npx nx test commerce-admin -- src/josh-admin/app/page/CS/RefundRequestsAdmin.spec.tsx` → FAIL.
- [ ] **Step 3: Implement** the API module, the page, the route, the admin-routes entry and the nav entry.
- [ ] **Step 4: Run** the page spec plus `npx nx test commerce-admin -- src/app/navigation.spec.ts` → PASS. For an admin-only link, `navigation.spec.ts` should need no `reviewedAdditions` change. If it fails, the link was wrongly added to `ROLE_ACCESS`.
- [ ] **Step 5: Commit**

```bash
git add apps/commerce-admin/src
git commit -m "feat(commerce-admin): josh refund requests queue page"
```

---

## Finish

- [ ] Run the full josh backend unit suite: `npx nx test backend` → PASS. Then run `npx tsc -p apps/backend/tsconfig.app.json --noEmit`.
- [ ] Run the commerce suites: `npx nx test commerce-platform --testFile=josh-admin-call` and `npx nx test commerce-admin`.
- [ ] Do a manual sandbox check on a local josh with KBank sandbox keys and `REFUND_FLOW_ENABLED=true`:
  1. Pay a sandbox card order and deliver it.
  2. Report a return → choose card → approve in commerce-admin → the void succeeds.
  3. Repeat with a partial return → refund.
  4. QR order → bank account + bookbank → approve → mark transferred.
  5. Simulate an ERP invoice below the order → after the cron, a weight-diff request appears.
- [ ] Hand the branch to `superpowers:requesting-code-review`, plus `security-reviewer` for the PII, uploads and KBank money path.
- [ ] Push both branches once at the end of the round (push rule). Open PRs. Do not deploy.
- [ ] Write a completion doc `.claude/completions/2026-10-10-josh-refund-requests.md` (CLAUDE.md protocol).

## Out of scope (tracked, not built)

- shop-web screens and mobile app screens. The API is ready for both.
- Paid-order cancellation refunds, which go through this flow later via a new `source`.
- ERP credit note per refund.
- `refund.*` events to commerce for reporting.
- A return window (days after delivery).
- A dedicated `finance` staff role.
