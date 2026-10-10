import { useEffect, useState } from "react";
import { Alert } from "@cp/ui";
import { WorkspaceLink } from "../../WorkspaceParts";
import { commerceText as text } from "../../commerce-copy";
import { readPriceJobs } from "./price-approval-journal";
import { readManualJobs } from "./manual-price-journal";
export function usePriceRequests(owner: string) {
  const [, update] = useState(0);
  useEffect(() => {
    const refresh = () => update((n) => n + 1);
    window.addEventListener("storage", refresh);
    window.addEventListener("cp-price-approval-journal", refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener("cp-price-approval-journal", refresh);
    };
  }, [owner]);
  return { approvals: readPriceJobs(owner), edits: readManualJobs(owner) };
}
export function PriceRequestLinks({
  owner,
  sku,
}: {
  owner: string;
  sku?: string;
}) {
  const requests = usePriceRequests(owner),
    approvals = requests.approvals.filter(
      (job) => !sku || job.packet.changes.some((change) => change.sku === sku),
    ),
    edits = requests.edits.filter((job) => !sku || job.packet.sku === sku);
  return approvals.length + edits.length ? (
    <Alert tone="warn">
      <p>
        {text(
          "ตรวจคำขอเดิมก่อนเปลี่ยนราคาอีกครั้ง",
          "Check original requests before changing prices again",
        )}
      </p>
      <p className="text-sm">
        {text(
          "มีคำขอเดิมที่เก็บในเครื่อง ผลยังไม่ยืนยันจนกว่าจะตรวจคำขอ",
          "Original requests are retained on this device. Outcomes remain unverified until checked.",
        )}
      </p>
      {approvals.map((j) => (
        <WorkspaceLink
          key={"approval:" + j.packet.requestId}
          to={"/product-prices/requests/" + j.packet.requestId}
        >
          <span className="break-words">
            {text("ตรวจคำขอ ERP: ", "Check ERP request: ") +
              j.packet.changes.map((c) => c.sku).join(", ")}
          </span>
        </WorkspaceLink>
      ))}
      {edits.map((j) => (
        <WorkspaceLink
          key={"edit:" + j.packet.requestId}
          to={"/product-prices/current/requests/" + j.packet.requestId}
        >
          <span className="break-words">
            {text("ตรวจคำขอแก้ราคา: ", "Check price edit: ") + j.packet.sku}
            {j.conflict && (
              <span className="block text-sm">
                {text(
                  "ข้อมูลเปลี่ยน — ตรวจผลก่อนเริ่มใหม่",
                  "Evidence changed — check outcome before starting again",
                )}
              </span>
            )}
          </span>
        </WorkspaceLink>
      ))}
    </Alert>
  ) : null;
}
