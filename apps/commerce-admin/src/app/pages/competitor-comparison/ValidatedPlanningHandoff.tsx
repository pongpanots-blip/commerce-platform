import { ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { Alert, Loading, Panel, PanelHead } from "@cp/ui";
import { z } from "zod";
import { api } from "../../../lib/api";
import { commerceText as text } from "../../commerce-copy";
import { useAsync } from "../../hooks";
import { WorkspaceLink } from "../../WorkspaceParts";
import { PlanningError as ErrorText } from "../planning/PlanningError";
import {
  COMPARISON_API,
  COMPARISON_HOME,
  comparisonHandoffSchema,
  comparisonUuid,
  parseComparisonHandoff,
} from "../../../../../commerce-platform/src/modules/integration/competitor-prices/comparison-contracts";
export type PlanningReferral = z.infer<typeof comparisonHandoffSchema> & {
  selectedIds: string[];
};
/** Query parameters only identify evidence to re-read; they never provide prices or permission. */
export function ValidatedPlanningHandoff({
  children,
}: {
  children: (referral?: PlanningReferral) => ReactNode;
}) {
  const [params] = useSearchParams(),
    sku = params.get("comparisonSku"),
    fingerprint = params.get("comparisonFingerprint"),
    ids = (params.get("comparisonPairs") ?? "").split(",").filter(Boolean);
  const valid =
    !!sku &&
    sku.length <= 100 &&
    !!fingerprint &&
    /^[a-f0-9]{64}$/.test(fingerprint) &&
    ids.length > 0 &&
    ids.length <= 20 &&
    new Set(ids).size === ids.length &&
    ids.every((id) => comparisonUuid.safeParse(id).success);
  const source = useAsync(async () => {
    if (!sku || !valid) return null;
    const v = parseComparisonHandoff(
      await api.get(`${COMPARISON_API}/handoff/${encodeURIComponent(sku)}`),
      sku,
      fingerprint!,
      ids,
    );
    return { ...v, selectedIds: ids };
  }, [sku, fingerprint, params.get("comparisonPairs"), valid]);
  if (!sku) return <>{children()}</>;
  if (!valid)
    return (
      <Alert tone="danger">
        {text(
          "ลิงก์หลักฐานไม่ถูกต้อง เปิดหน้าเทียบราคาเพื่อเลือกใหม่",
          "Invalid evidence link. Select evidence in competitor comparison.",
        )}{" "}
        <WorkspaceLink to={COMPARISON_HOME}>
          {text("เปิดหน้าเทียบราคา", "Open comparison")}
        </WorkspaceLink>
      </Alert>
    );
  if (source.loading) return <Loading variant="detail" />;
  if (source.error || !source.data)
    return (
      <>
        <ErrorText error={source.error} onRetry={source.reload} />
        <WorkspaceLink
          to={`${COMPARISON_HOME}/products/${encodeURIComponent(sku)}`}
        >
          {text("ทบทวนฐานราคาล่าสุด", "Review current price evidence")}
        </WorkspaceLink>
      </>
    );
  return (
    <>
      <Panel>
        <PanelHead
          title={text(
            "หลักฐานจากการเทียบราคา",
            "Evidence from competitor comparison",
          )}
        />
        <div className="p-4 space-y-2">
          <p>
            {source.data.productName} · {source.data.sku}
          </p>
          <p>
            {text(
              "คู่สินค้าที่เลือกและอ่านยืนยันอีกครั้ง",
              "Selected pairs re-read and validated",
            )}
            : {ids.length}
          </p>
          <Alert tone="muted">
            {text(
              "หลักฐานเดิมอยู่ในประวัติการเทียบราคา การวางแผนจะอ่านฐานสินค้าของตัวเองใหม่ ราคาคู่แข่งไม่ใช่ต้นทุนหรือคำสั่งตั้งราคา",
              "Original evidence remains in comparison history. Planning reads its own product basis again. Competitor prices are not costs or selling-price instructions.",
            )}
          </Alert>
          <WorkspaceLink
            to={`${COMPARISON_HOME}/products/${encodeURIComponent(sku)}`}
          >
            {text("เปิดหลักฐานต้นทาง", "Open source evidence")}
          </WorkspaceLink>
        </div>
      </Panel>
      {children(source.data)}
    </>
  );
}
