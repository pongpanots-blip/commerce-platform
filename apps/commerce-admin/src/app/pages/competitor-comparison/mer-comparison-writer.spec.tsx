// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setUiLocale } from "@cp/ui";
import { api } from "../../../lib/api";
import { useComparisonWriter } from "./comparison-interactions";
import { readComparisonJobs, type ComparisonJob } from "./comparison-journal";

vi.mock("../../../lib/api", () => ({ api: { post: vi.fn() } }));
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const owner = "synthetic-owner";
const id = "00000000-0000-4000-8000-000000000010";
const job: ComparisonJob = {
  owner,
  conflict: false,
  packet: {
    requestId: id,
    sku: "SYNTHETIC-SKU",
    sourceFingerprint: "a".repeat(64),
    commands: [
      {
        operation: "verify",
        pairId: id,
        revision: 1,
        relationship: "same_product",
        note: "Reviewed actual synthetic source evidence",
      },
    ],
  },
};
const receipt = {
  kind: "competitor_action",
  id,
  requestId: id,
  packet: job.packet,
  status: "committed",
  persisted: true,
  sellingPriceWrites: false,
  activationAllowed: false,
  savedAt: "2026-10-10T00:00:00Z",
  results: [
    {
      index: 0,
      pairId: id,
      status: "applied",
      message: "",
      before: null,
      after: { id, revision: 2 },
    },
  ],
};
let container: HTMLDivElement, root: Root | null;
let writer: ReturnType<typeof useComparisonWriter>;
function Harness() {
  writer = useComparisonWriter(owner);
  return <span>{writer.error}</span>;
}
beforeEach(async () => {
  vi.resetAllMocks();
  localStorage.clear();
  setUiLocale("en");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(<Harness />));
});
afterEach(async () => {
  await act(async () => root?.unmount());
  container.remove();
});
it("a writer cannot dispatch a request from a different account", async () => {
  await act(async () => {
    expect(await writer.write({ ...job, owner: "other-account" })).toBeNull();
  });
  expect(api.post).not.toHaveBeenCalled();
  expect(readComparisonJobs(owner)).toEqual([]);
  expect(readComparisonJobs("other-account")).toEqual([]);
  expect(container.textContent).toContain("belongs to a different account");
});
it("a validated mounted POST response retains its request until Recovery acknowledges it", async () => {
  vi.mocked(api.post).mockResolvedValue(receipt);
  await act(async () => {
    expect(await writer.write(job)).toMatchObject({ persisted: true });
  });
  expect(readComparisonJobs(owner)[0].packet).toEqual(job.packet);
});
it("a commit after unmount retains the original immutable request for reconciliation", async () => {
  let complete!: (value: unknown) => void;
  vi.mocked(api.post).mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  let result!: ReturnType<typeof writer.write>;
  await act(async () => {
    result = writer.write(job);
  });
  expect(readComparisonJobs(owner)[0].packet).toEqual(job.packet);
  await act(async () => {
    root!.unmount();
    root = null;
  });
  complete(receipt);
  expect(await result).toBeNull();
  expect(readComparisonJobs(owner)[0].packet).toEqual(job.packet);
  expect(api.post).toHaveBeenCalledTimes(1);
});
