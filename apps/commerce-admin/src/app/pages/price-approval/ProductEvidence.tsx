import { Alert, Button, Empty, Loading, Panel, useUiLocale } from "@cp/ui";
import { api } from "../../../lib/api";
import { useAsync } from "../../hooks";
import { commerceText as text } from "../../commerce-copy";
import { productEvidenceSchema } from "../../../../../commerce-platform/src/modules/commerce/product-evidence/product-evidence-contracts";

const show = (v: unknown) =>
  v == null ? text("ยังไม่มีข้อมูล", "Not recorded") : String(v);
const provenance = (source: string, at: string | null) =>
  `${source === "native" ? text("ข้อมูลระบบหลัก", "Native record") : source === "archived_native" ? text("ข้อมูลระบบหลักที่เก็บไว้", "Archived native record") : source === "copied_snapshot" ? text("สำเนาแค็ตตาล็อก", "Catalog snapshot") : text("ยังไม่มีข้อมูล", "Unavailable")} · ${show(at)}`;
export function ProductEvidence({ sku }: { sku: string }) {
  useUiLocale();
  const q = useAsync(async () => {
    const evidence = productEvidenceSchema.parse(
      await api.get("/product-evidence/" + encodeURIComponent(sku)),
    );
    if (evidence.sku !== sku) throw Error("Evidence identity differs");
    return evidence;
  }, [sku]);
  return (
    <Panel>
      <div className="p-4 space-y-4 min-w-0" aria-busy={q.loading}>
        <h2 className="font-semibold">
          {text(
            "ตรวจสอบต้นทุน หน่วย และสต็อก",
            "Inspect cost, units and stock",
          )}
        </h2>
        {q.loading ? (
          <Loading variant="detail" />
        ) : q.error ? (
          <Alert tone="danger">
            <p>
              {text("อ่านข้อมูลประกอบไม่ได้", "Evidence could not be loaded")}
            </p>
            <Button onClick={q.reload}>{text("ลองอีกครั้ง", "Retry")}</Button>
          </Alert>
        ) : (
          q.data && (
            <>
              <Alert tone="info">
                {text(
                  "เวลาแสดงคือเวลาบันทึก ไม่ยืนยันความใหม่ของแหล่งข้อมูล สกุลเงิน ภาษี หน่วยต้นทุนและสต็อกยังไม่ระบุ จึงยังคำนวณกำไรหรือแปลงหน่วยไม่ได้",
                  "Times show when records were stored; source freshness is unverified. Currency, tax, cost and stock units are not recorded, so margin and unit conversions are unavailable.",
                )}
              </Alert>
              <dl className="grid gap-4 sm:grid-cols-2 break-words">
                <div>
                  <dt className="font-medium">
                    {text("ต้นทุนที่บันทึก", "Recorded cost")}
                  </dt>
                  <dd>{show(q.data.cost.amount)}</dd>
                  <dd className="text-sm">
                    {provenance(q.data.cost.source, q.data.cost.recordedAt)}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium">
                    {text(
                      "หน่วยขาย / หน่วยสั่ง / ขนาดบรรจุ",
                      "Selling unit / ordering unit / pack",
                    )}
                  </dt>
                  <dd>
                    {show(q.data.units.selling)} / {show(q.data.units.ordering)}{" "}
                    / {show(q.data.units.packSize)}
                  </dd>
                  <dd className="text-sm">
                    {provenance(q.data.units.source, q.data.units.recordedAt)}
                  </dd>
                </div>
              </dl>
              <h3 className="font-medium">
                {text("สต็อกตามคลัง", "Stock by warehouse")}
              </h3>
              {q.data.stock.status !== "recorded" ? (
                <Empty>
                  <p className="font-medium">
                    {text("ยังยืนยันสต็อกไม่ได้", "Stock unavailable")}
                  </p>
                  <p>
                    {q.data.stock.status === "ambiguous_identity"
                      ? text(
                          "รหัสสินค้านี้ตรงกับสินค้ามากกว่าหนึ่งรายการ",
                          "This SKU matches multiple products.",
                        )
                      : q.data.stock.status === "organization_scope_unavailable"
                        ? text(
                            "ต้องยืนยันขอบเขตองค์กรก่อนอ่านสต็อก",
                            "Organization scope must be confirmed before reading stock.",
                          )
                        : text(
                            "ไม่มีระดับสต็อกที่ระบุได้ ไม่ถือว่าเป็นศูนย์",
                            "No stock level is identified; this does not mean zero.",
                          )}
                  </p>
                </Empty>
              ) : (
                <ul className="space-y-3">
                  {q.data.stock.warehouses.map((w) => (
                    <li
                      key={w.code}
                      className="rounded border border-outline-variant p-3"
                    >
                      <p className="font-medium">
                        {w.name} ({w.code})
                      </p>
                      <p>
                        {text("จำนวน", "Quantity")}: {w.quantity} ·{" "}
                        {text("จอง", "Reserved")}: {w.reserved}
                      </p>
                      <p className="text-sm">
                        {w.owner === "commerce"
                          ? text(
                              "คลังของเรา",
                              "Commerce-managed warehouse",
                            )
                          : text(
                              "คลังจากระบบหลัก (ERP)",
                              "ERP-managed warehouse",
                            )}{" "}
                        ·{" "}
                        {w.sellable
                          ? text(
                              "นับเป็นสต็อกขาย",
                              "Included in sellable stock",
                            )
                          : text(
                              "ไม่นับเป็นสต็อกขาย",
                              "Excluded from sellable stock",
                            )}{" "}
                        · {show(w.recordedAt)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )
        )}
      </div>
    </Panel>
  );
}
