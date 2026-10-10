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
export function PriceRequestLinks({ owner }: { owner: string }) {
  const { approvals, edits } = usePriceRequests(owner);
  return approvals.length + edits.length ? (
    <Alert tone="warn">
      <p>
        {text(
          "ตรวจคำขอเดิมก่อนเปลี่ยนราคาอีกครั้ง",
          "Check original requests before changing prices again",
        )}
      </p>
      {approvals.map((j) => (
        <WorkspaceLink
          key={"approval:" + j.packet.requestId}
          to={"/product-prices/requests/" + j.packet.requestId}
        >
          {j.packet.changes.map((c) => c.sku).join(", ")}
        </WorkspaceLink>
      ))}
      {edits.map((j) => (
        <WorkspaceLink
          key={"edit:" + j.packet.requestId}
          to={"/product-prices/current/requests/" + j.packet.requestId}
        >
          {text("แก้ราคา: ", "Price edit: ") + j.packet.sku}
        </WorkspaceLink>
      ))}
    </Alert>
  ) : null;
}
