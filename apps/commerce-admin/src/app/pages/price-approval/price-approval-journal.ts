import { z } from "zod";
import {
  priceApprovalPacketSchema,
  priceApprovalReviewSchema,
  type PriceApprovalPacket,
  type PriceApprovalReview,
} from "../../../../../commerce-platform/src/modules/commerce/product-prices/price-approval-contracts";
const jobSchema = z.strictObject({
  owner: z.string().min(1),
  packet: priceApprovalPacketSchema,
  review: priceApprovalReviewSchema,
  conflict: z.boolean(),
});
export type PriceApprovalJob = z.infer<typeof jobSchema>;
const prefix = (owner: string) =>
  `cp-price-approval-request:${encodeURIComponent(owner)}:`;
const key = (owner: string, id: string) => prefix(owner) + id;
export const reviewKey = (owner: string, path: string) =>
  `cp-price-approval-review:${owner}:${path}`;
export function matchesReview(
  packet: PriceApprovalPacket,
  review: PriceApprovalReview,
) {
  return (
    packet.changes.length === review.items.length &&
    packet.changes.every(
      (c, n) =>
        c.sku === review.items[n].sku && c.version === review.items[n].version,
    )
  );
}
export function readPriceJobs(owner: string): PriceApprovalJob[] {
  try {
    const keys = Array.from({ length: localStorage.length }, (_, n) =>
      localStorage.key(n),
    )
      .filter((k): k is string => !!k && k.startsWith(prefix(owner)))
      .sort();
    return keys.flatMap((k) => {
      let raw: unknown;
      try {
        raw = JSON.parse(localStorage.getItem(k) ?? "null");
      } catch {
        return [];
      }
      const j = jobSchema.safeParse(raw);
      return j.success &&
        j.data.owner === owner &&
        k === key(owner, j.data.packet.requestId) &&
        matchesReview(j.data.packet, j.data.review)
        ? [j.data]
        : [];
    });
  } catch {
    return [];
  }
}
export function storePriceJob(job: PriceApprovalJob) {
  const valid = jobSchema.parse(job);
  if (!matchesReview(valid.packet, valid.review))
    throw Error("Reviewed scope differs from the request");
  const jobs = readPriceJobs(job.owner),
    prior = jobs.find((j) => j.packet.requestId === job.packet.requestId);
  if (
    prior &&
    (JSON.stringify(prior.packet) !== JSON.stringify(valid.packet) ||
      JSON.stringify(prior.review) !== JSON.stringify(valid.review))
  )
    throw Error("Original request and evidence must remain immutable");
  if (!prior && jobs.length >= 30)
    throw Error("Resolve earlier requests before confirming");
  // Each request has its own key: concurrent tabs cannot overwrite unrelated
  // requests when inserting or clearing one immutable intent.
  localStorage.setItem(
    key(job.owner, valid.packet.requestId),
    JSON.stringify(valid),
  );
  if (
    JSON.stringify(
      readPriceJobs(job.owner).find(
        (j) => j.packet.requestId === valid.packet.requestId,
      ),
    ) !== JSON.stringify(valid)
  )
    throw Error("Recovery storage unavailable. No decision was sent.");
  window.dispatchEvent(new Event("cp-price-approval-journal"));
}
export function clearPriceJob(owner: string, id: string) {
  localStorage.removeItem(key(owner, id));
  window.dispatchEvent(new Event("cp-price-approval-journal"));
}
export function readPriceReview(owner: string, path: string) {
  try {
    const v = priceApprovalReviewSchema.safeParse(
      JSON.parse(localStorage.getItem(reviewKey(owner, path)) ?? "null"),
    );
    return v.success ? v.data : null;
  } catch {
    return null;
  }
}
export function storePriceReview(
  owner: string,
  path: string,
  review: PriceApprovalReview,
) {
  if (!owner) throw Error("Account identity unavailable");
  const valid = priceApprovalReviewSchema.parse(review);
  localStorage.setItem(reviewKey(owner, path), JSON.stringify(valid));
  if (JSON.stringify(readPriceReview(owner, path)) !== JSON.stringify(valid))
    throw Error("Review storage unavailable. No decision was sent.");
}
