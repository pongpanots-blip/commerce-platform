import {
  assignmentPacketSchema,
  type AssignmentPacket,
} from "../../../../../commerce-platform/src/modules/integration/customers/assignment-contracts";
export type AssignmentJob = {
  owner: string;
  packet: AssignmentPacket;
  rejected?: boolean;
};
const key = (owner: string) => `cp-customer-assignment-requests:${owner}`;
export const assignmentFormKey = (owner: string) =>
  `cp-customer-assignment-selection:${owner}`;
export function readAssignmentJobs(owner: string): AssignmentJob[] {
  try {
    const list = JSON.parse(localStorage.getItem(key(owner)) ?? "[]");
    if (!Array.isArray(list) || list.length > 20) return [];
    return list.flatMap((job) => {
      const result = assignmentPacketSchema.safeParse(job.packet);
      return job.owner === owner && result.success
        ? [{ owner, packet: result.data, rejected: job.rejected === true }]
        : [];
    });
  } catch {
    return [];
  }
}
export function storeAssignmentJob(job: AssignmentJob) {
  if (!job.owner) throw Error("Account identity unavailable");
  const packet = assignmentPacketSchema.parse(job.packet),
    jobs = readAssignmentJobs(job.owner),
    previous = jobs.find((j) => j.packet.requestId === packet.requestId);
  if (previous && JSON.stringify(previous.packet) !== JSON.stringify(packet))
    throw Error("Original assignment request must stay immutable");
  const next = [
    ...jobs.filter((j) => j.packet.requestId !== packet.requestId),
    { owner: job.owner, packet, rejected: job.rejected === true },
  ];
  if (next.length > 20)
    throw Error("Resolve earlier assignment requests first");
  localStorage.setItem(key(job.owner), JSON.stringify(next));
  if (
    JSON.stringify(
      readAssignmentJobs(job.owner).find(
        (j) => j.packet.requestId === packet.requestId,
      )?.packet,
    ) !== JSON.stringify(packet)
  )
    throw Error("Recovery storage unavailable");
  window.dispatchEvent(new Event("cp-assignment-journal"));
}
export function clearAssignmentJob(owner: string, requestId: string) {
  localStorage.setItem(
    key(owner),
    JSON.stringify(
      readAssignmentJobs(owner).filter((j) => j.packet.requestId !== requestId),
    ),
  );
  window.dispatchEvent(new Event("cp-assignment-journal"));
}
