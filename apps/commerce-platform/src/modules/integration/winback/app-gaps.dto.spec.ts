import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  ActivityDraftDto,
  AppointmentPlanDto,
  CollabMessageDto,
  CreateCollabRequestDto,
  CompleteSignalDto,
  CreateCoachingTaskDto,
  DiscoveryQueryDto,
  DismissSignalDto,
  MoveQuoteDto,
  OpportunityQueryDto,
  QuoteDispatchDto,
  QuoteTermsCatalogDto,
  ResolveCollabRequestDto,
  ReviewDailyReportDto,
  SaveQuoteDto,
  SignalQueryDto,
  TeamDto,
  UpdateOpportunityMetaDto,
  VisitCompletionDto,
  VisitStartEvidenceDto,
  WorkPlanDto,
  WorkPlanQueryDto,
} from './dto/app-gaps.dto';
import { CheckoutDto } from './dto/create-activity.dto';

const UUID = '00000000-0000-4000-8000-000000000001';

/** Same options as the controller pipe (transform + whitelist). */
async function check<T extends object>(cls: new () => T, value: object) {
  const dto = plainToInstance(cls, value);
  const errors = await validate(dto, { whitelist: true });
  return { dto, fields: errors.map((e) => e.property) };
}

describe('app gap DTOs', () => {
  it('opportunity query: comma lists, numbers from strings, enum tab, defaults', async () => {
    const { dto, fields } = await check(OpportunityQueryDto, {
      province_codes: 'TH-10,TH-11', segments: 'french,italian', min_spend: '500.0', tab: 'near_warehouse', sort: 'sales_priority_desc',
    });
    expect(fields).toEqual([]);
    expect(dto).toMatchObject({ province_codes: ['TH-10', 'TH-11'], segments: ['french', 'italian'], min_spend: 500, page: 1, limit: 20 });
    expect((await check(OpportunityQueryDto, { tab: 'hot' })).fields).toEqual(['tab']);
    expect((await check(OpportunityQueryDto, { province_codes: 'Bangkok' })).fields).toEqual(['province_codes']);
    expect((await check(OpportunityQueryDto, { segments: 'thai' })).fields).toEqual(['segments']);
    expect((await check(OpportunityQueryDto, { limit: '101' })).fields).toEqual(['limit']);
  });

  it('opportunity query (§4.11.8): stage / purpose / recommendation enums, owner UUID, unassigned_only boolean', async () => {
    const { dto, fields } = await check(OpportunityQueryDto, {
      stage: 'negotiate', purpose: 'winback', recommendation: 'needs_research', owner_sales_user_id: UUID, unassigned_only: 'false',
    });
    expect(fields).toEqual([]);
    expect(dto).toMatchObject({ stage: 'negotiate', purpose: 'winback', recommendation: 'needs_research', owner_sales_user_id: UUID, unassigned_only: false });
    expect((await check(OpportunityQueryDto, { unassigned_only: 'true' })).dto.unassigned_only).toBe(true);
    expect((await check(OpportunityQueryDto, { stage: 'hot' })).fields).toEqual(['stage']);
    expect((await check(OpportunityQueryDto, { purpose: 'upsell' })).fields).toEqual(['purpose']);
    expect((await check(OpportunityQueryDto, { recommendation: 'urgent' })).fields).toEqual(['recommendation']);
    expect((await check(OpportunityQueryDto, { owner_sales_user_id: 'rep-1' })).fields).toEqual(['owner_sales_user_id']);
    // not offered: restaurant_place has no cuisine / district code (whitelist drops them)
    expect((await check(OpportunityQueryDto, { cuisine_id: UUID, district_codes: '1001' })).dto).not.toHaveProperty('cuisine_id');
  });

  it('opportunity meta PATCH + collaboration bodies', async () => {
    expect((await check(UpdateOpportunityMetaDto, { stage: 'won', purpose: 'expansion', expected_version: '0' })).dto.expected_version).toBe(0);
    expect((await check(UpdateOpportunityMetaDto, { stage: 'hot' })).fields).toEqual(['stage']);
    expect((await check(UpdateOpportunityMetaDto, { purpose: 'x' })).fields).toEqual(['purpose']);
    expect((await check(UpdateOpportunityMetaDto, { expected_version: -1 })).fields).toEqual(['expected_version']);
    expect((await check(CreateCollabRequestDto, { kind: 'handoff', recipient_id: UUID, reason: 'r' })).fields).toEqual([]);
    expect((await check(CreateCollabRequestDto, { kind: 'transfer', recipient_id: 'x', reason: '' })).fields).toEqual(['kind', 'recipient_id', 'reason']);
    expect((await check(CreateCollabRequestDto, { kind: 'coordinate', recipient_id: UUID, reason: 'r'.repeat(1001) })).fields).toEqual(['reason']);
    expect((await check(ResolveCollabRequestDto, { status: 'approved', note: 'ok' })).fields).toEqual([]);
    expect((await check(ResolveCollabRequestDto, { status: 'pending', note: '' })).fields).toEqual(['status', 'note']);
    expect((await check(CollabMessageDto, { recipient_id: UUID, text: 'hi', is_call_note: true })).fields).toEqual([]);
    expect((await check(CollabMessageDto, { recipient_id: UUID, text: '', is_call_note: 'yes' })).fields).toEqual(['text', 'is_call_note']);
  });

  it('signals: status enum, ordered is not a completion outcome, dismiss needs a reason', async () => {
    expect((await check(SignalQueryDto, { status: 'snoozed' })).fields).toEqual(['status']);
    expect((await check(SignalQueryDto, {})).dto.limit).toBe(15);
    expect((await check(CompleteSignalDto, { outcome: 'follow_up', note: 'x' })).fields).toEqual([]);
    expect((await check(CompleteSignalDto, { outcome: 'ordered' })).fields).toEqual(['outcome']);
    expect((await check(DismissSignalDto, { reason: '' })).fields).toEqual(['reason']);
  });

  it('appointment plan: enums, objective ≤300, nested products', async () => {
    const ok = { place_code: 'storefront', purpose_code: 'quote', objective: 'เสนอสินค้า', end_at: '2026-10-08T05:00:00Z',
      products: [{ product_id: 'p', sku: 'S', name: 'n', unit_id: 'selling', unit_label: 'KG', quantity: 2 }] };
    expect((await check(AppointmentPlanDto, ok)).fields).toEqual([]);
    expect((await check(AppointmentPlanDto, { ...ok, place_code: 'cafe' })).fields).toEqual(['place_code']);
    expect((await check(AppointmentPlanDto, { ...ok, objective: 'x'.repeat(301) })).fields).toEqual(['objective']);
    expect((await check(AppointmentPlanDto, { ...ok, products: [{ ...ok.products[0], quantity: 0 }] })).fields).toEqual(['products']);
  });

  it('visit completion + start evidence', async () => {
    const product = { product_id: 'p', sku: 'S', name: 'n', unit_id: 'selling', unit_label: 'KG', quantity: 1, reaction: 'sampled' };
    expect((await check(VisitCompletionDto, { products: [product], next_action: 'follow_up', follow_up_at: '2026-10-10' })).fields).toEqual([]);
    expect((await check(VisitCompletionDto, { products: [{ ...product, reaction: 'loved' }] })).fields).toEqual(['products']);
    expect((await check(VisitCompletionDto, { products: [], next_action: 'call' })).fields).toEqual(['next_action']);
    expect((await check(VisitStartEvidenceDto, { photo_urls: ['a', 'b', 'c', 'd'] })).fields).toEqual(['photo_urls']);
  });

  it('draft, coaching, team, work plan, discovery', async () => {
    expect((await check(ActivityDraftDto, { type: 'call', outcome: '' })).fields).toEqual([]);
    expect((await check(ActivityDraftDto, { type: 'fax' })).fields).toEqual(['type']);
    expect((await check(CreateCoachingTaskDto, { sales_user_id: UUID, account_id: UUID, action: 'a', due_at: '2026-10-10', manager_note: '' })).fields).toEqual(['manager_note']);
    expect((await check(TeamDto, { name: 'T', sales_user_ids: [UUID, UUID] })).fields).toEqual(['sales_user_ids']);
    expect((await check(WorkPlanDto, { completed: ['contact', 'nap'] })).fields).toEqual(['completed']);
    expect((await check(WorkPlanQueryDto, { account_ids: `${UUID},nope` })).fields).toEqual(['account_ids']);
    expect((await check(DiscoveryQueryDto, { radius_km: '7' })).fields).toEqual(['radius_km']);
    expect((await check(DiscoveryQueryDto, { radius_km: '5', origin_lat: '13.7', origin_lng: '100.5' })).dto).toMatchObject({ radius_km: 5, origin_lat: 13.7 });
  });

  it('commercial: quote lines / dates, status (no expired), dispatch channel, terms, review', async () => {
    const quote = { account_id: UUID, lines: [{ product_id: 'p', unit_id: 'selling', quantity: 2 }], valid_until: '2026-10-31' };
    expect((await check(SaveQuoteDto, quote)).fields).toEqual([]);
    expect((await check(SaveQuoteDto, { ...quote, valid_until: '31/10/2026' })).fields).toEqual(['valid_until']);
    expect((await check(SaveQuoteDto, { ...quote, lines: [{ product_id: 'p', unit_id: 'selling', quantity: -1 }] })).fields).toEqual(['lines']);
    expect((await check(MoveQuoteDto, { status: 'expired', expected_version: 1 })).fields).toEqual(['status']);
    expect((await check(QuoteDispatchDto, { channel: 'sms', content_version: 1, expected_version: 1 })).fields).toEqual(['channel']);
    expect((await check(QuoteTermsCatalogDto, {
      credit_days: [0, 30], price_lists: [{ id: 'std', label: 'Standard' }], warehouses: [],
      delivery_slots: [{ id: 's', label: 'Wed', weekdays: [3, 8], before_minutes: 600 }],
    })).fields).toEqual(['delivery_slots']);
    expect((await check(ReviewDailyReportDto, { approved: 'yes', expected_version: 1 })).fields).toEqual(['approved']);
  });

  it('checkout accepts an optional stage_after (enum)', async () => {
    expect((await check(CheckoutDto, { outcome: 'interested', types: ['visit'], stage_after: 'negotiate' })).fields).toEqual([]);
    expect((await check(CheckoutDto, { outcome: 'interested', types: ['visit'], stage_after: 'closed' })).fields).toEqual(['stage_after']);
  });
});
