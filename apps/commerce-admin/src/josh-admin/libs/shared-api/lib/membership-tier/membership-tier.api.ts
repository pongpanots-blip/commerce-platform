import { apiClient } from '../api-client/api-client';

/**
 * Membership tier config (Task 10 of the SEGMENTS/TIERS plan) — mirrors
 * `apps/backend/src/entities/membership-tier.entity.ts`. Backend NUMERIC
 * columns (`min_lifetime_spend`) come back over the wire as strings (no
 * TypeORM transformer is configured), so every read path here coerces to
 * `number` before handing the tier to callers.
 */
export type MembershipTier = {
  id: string;
  name: string;
  slug: string;
  color: string;
  min_lifetime_spend: number;
  sort_order: number;
  is_active: boolean;
};

type MembershipTierWire = Omit<MembershipTier, 'min_lifetime_spend'> & {
  min_lifetime_spend: number | string;
};

const normalizeTier = (tier: MembershipTierWire): MembershipTier => ({
  ...tier,
  min_lifetime_spend: Number(tier.min_lifetime_spend ?? 0),
});

export type CreateMembershipTierPayload = {
  name: string;
  slug: string;
  color?: string;
  min_lifetime_spend?: number;
  sort_order?: number;
  is_active?: boolean;
};

export type UpdateMembershipTierPayload = Partial<CreateMembershipTierPayload>;

/** One row of `GET /membership-tiers/distribution` — includes the untiered (`tier: null`) bucket. */
export type MembershipTierDistributionEntry = {
  tier: { id: string; name: string; slug: string } | null;
  count: number;
};

/** `GET /membership-tiers` — ordered by `sort_order` ASC. */
export const listTiers = async (): Promise<MembershipTier[]> => {
  const response = await apiClient.get<{ data: MembershipTierWire[] }>(
    '/membership-tiers',
  );
  return (response.data?.data ?? []).map(normalizeTier);
};

export const createTier = async (
  payload: CreateMembershipTierPayload,
): Promise<MembershipTier> => {
  const response = await apiClient.post<{ data: MembershipTierWire }>(
    '/membership-tiers',
    payload,
  );
  return normalizeTier(response.data.data);
};

export const updateTier = async (
  id: string,
  payload: UpdateMembershipTierPayload,
): Promise<MembershipTier> => {
  const response = await apiClient.patch<{ data: MembershipTierWire }>(
    `/membership-tiers/${id}`,
    payload,
  );
  return normalizeTier(response.data.data);
};

export const deleteTier = async (id: string): Promise<void> => {
  await apiClient.delete(`/membership-tiers/${id}`);
};

/** `GET /membership-tiers/distribution` — customer count per tier, including untiered. */
export const getTierDistribution = async (): Promise<
  MembershipTierDistributionEntry[]
> => {
  const response = await apiClient.get<{
    data: MembershipTierDistributionEntry[];
  }>('/membership-tiers/distribution');
  return response.data?.data ?? [];
};
