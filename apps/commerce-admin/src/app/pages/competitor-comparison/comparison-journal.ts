import {
  comparisonPacketSchema,
  type ComparisonPacket,
} from "../../../../../commerce-platform/src/modules/integration/competitor-prices/comparison-contracts";
export type ComparisonJob = {
  owner: string;
  packet: ComparisonPacket;
  conflict: boolean;
};
const key = (owner: string) => `cp-comparison-requests:${owner}`;
export function readComparisonJobs(owner: string): ComparisonJob[] {
  try {
    const raw = JSON.parse(localStorage.getItem(key(owner)) ?? "[]");
    if (!Array.isArray(raw) || raw.length > 30) return [];
    return raw.flatMap((x) => {
      const packet = comparisonPacketSchema.safeParse(x.packet);
      return x.owner === owner && packet.success
        ? [{ owner, packet: packet.data, conflict: x.conflict === true }]
        : [];
    });
  } catch {
    return [];
  }
}
export function storeComparisonJob(job: ComparisonJob) {
  if (!job.owner) throw Error("Missing account identity");
  const packet = comparisonPacketSchema.parse(job.packet),
    jobs = readComparisonJobs(job.owner);
  const previous = jobs.find((x) => x.packet.requestId === packet.requestId);
  if (previous && JSON.stringify(previous.packet) !== JSON.stringify(packet))
    throw Error("Original request must remain immutable");
  const next = [
    ...jobs.filter((x) => x.packet.requestId !== packet.requestId),
    { ...job, packet },
  ];
  if (next.length > 30) throw Error("Resolve earlier requests before saving");
  localStorage.setItem(key(job.owner), JSON.stringify(next));
  const stored = readComparisonJobs(job.owner).find(
    (x) => x.packet.requestId === packet.requestId,
  );
  if (!stored || JSON.stringify(stored.packet) !== JSON.stringify(packet))
    throw Error("Recovery storage unavailable");
  window.dispatchEvent(new Event("cp-comparison-journal"));
}
export function clearComparisonJob(owner: string, id: string) {
  localStorage.setItem(
    key(owner),
    JSON.stringify(
      readComparisonJobs(owner).filter((x) => x.packet.requestId !== id),
    ),
  );
  window.dispatchEvent(new Event("cp-comparison-journal"));
}
export const comparisonFormKey = (owner: string, path: string) =>
  `cp-comparison-form:${owner}:${path}`;
