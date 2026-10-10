import { Alert, Chip, Panel, PanelHead } from "@cp/ui";
import type {
  PlanInputs,
  PlanPreview,
} from "../../../../../commerce-platform/src/modules/integration/commercial-work/commercial-work";
import { commerceText as text } from "../../commerce-copy";
import { dateText } from "../pack-price/pack-copy";
const labels: Record<string, [string, string]> = {
  assignment_unavailable: [
    "ยังไม่พบผู้รับผิดชอบที่ยืนยันได้",
    "Verified assignment unavailable",
  ],
  history_unavailable: [
    "อ่านประวัติออเดอร์ไม่ได้",
    "Order history unavailable",
  ],
  no_selected_order: [
    "ยังไม่ได้เลือกออเดอร์เพื่อทบทวนสั่งซ้ำ",
    "No historical order selected for reorder review",
  ],
  order_not_in_page: [
    "ออเดอร์ไม่อยู่ในหน้าประวัติที่อ่านได้",
    "Order outside the returned history page",
  ],
  order_not_paid: ["ยังไม่ยืนยันการชำระเงิน", "Payment unverified"],
  order_status_ineligible: [
    "สถานะออเดอร์ไม่เหมาะกับร่างสั่งซ้ำ",
    "Order status is ineligible for reorder review",
  ],
  order_company_mismatch: [
    "ออเดอร์และบริษัทไม่ตรงกัน",
    "Order and company identity mismatch",
  ],
  no_unambiguous_lines: [
    "ไม่มีรายการเดิมที่ระบุได้ชัดเจน",
    "No unambiguous historical lines",
  ],
  ambiguous_sku: [
    "SKU ซ้ำในออเดอร์ ต้องตรวจแยกก่อนเลือก",
    "Repeated order SKU requires individual review",
  ],
  invalid_historical_quantity: [
    "ปริมาณเดิมไม่ถูกต้อง",
    "Invalid historical quantity",
  ],
  line_limit_exceeded: [
    "ออเดอร์เกินขอบเขต 50 รายการ",
    "Order exceeds the 50-line review limit",
  ],
  inactive_product: [
    "สถานะสินค้าไม่ได้ระบุว่าใช้งานอยู่",
    "Product is not recorded active",
  ],
  price_unavailable: ["ราคาที่บันทึกไว้ไม่ครบ", "Recorded price unavailable"],
  image_missing: [
    "ยังไม่มีจำนวนรูปที่ยืนยันได้",
    "Verified image coverage missing",
  ],
  category_missing: ["ยังไม่พบหมวดหมู่", "Category missing"],
  recorded_stock_empty: [
    "สต็อกที่บันทึกไว้ไม่เป็นบวก",
    "Recorded stock is not positive",
  ],
  stock_unknown: ["สต็อกที่บันทึกไว้ไม่ทราบ", "Recorded stock unknown"],
  backorder_confirmation_required: [
    "สินค้ารับสั่ง ต้องยืนยันกำหนดส่ง",
    "Backorder requires delivery confirmation",
  ],
  complete_history: ["ประวัติครบทุกหน้า", "Complete order history"],
  reorder_cadence: ["รอบการสั่งซื้อ", "Reorder cadence"],
  selling_unit_mapping: [
    "หน่วยขายของรายการเดิม",
    "Historical selling-unit mapping",
  ],
  current_customer_price: [
    "ราคาปัจจุบันเฉพาะลูกค้า",
    "Current customer-specific price",
  ],
  available_to_promise: [
    "จำนวนพร้อมขายปัจจุบัน",
    "Current available-to-promise quantity",
  ],
  stock_age: ["อายุสต็อก", "Stock age"],
  effective_internal_cost: ["ต้นทุนภายในที่มีผล", "Effective internal cost"],
  spend: ["ค่าใช้จ่ายการตลาด", "Marketing spend"],
  attribution: ["ที่มาของยอดขาย", "Sales attribution"],
  upstream_freshness: ["ความสดใหม่ของต้นทาง", "Upstream freshness"],
};
export const evidenceLabel = (v: string) =>
  labels[v] ? text(...labels[v]) : v;
export function PlanSources({ inputs: i }: { inputs: PlanInputs }) {
  return (
    <Panel>
      <PanelHead
        title={text(
          "หลักฐานและสิ่งที่ยังต้องยืนยัน",
          "Evidence and required confirmations",
        )}
      />
      <div className="p-4 min-w-0 break-words space-y-3">
        <p>
          {i.subject.name} · {i.subject.id}
        </p>
        <p>
          {text("ขอบเขต", "Scope")}:{" "}
          {i.scope === "own_assigned_company"
            ? text(
                "บริษัทที่ฉันรับผิดชอบตามต้นทาง",
                "My source-authorized assigned companies",
              )
            : i.scope === "authorized_team_company"
              ? text("บริษัทของทีมตามสิทธิ์เดิม", "Authorized team companies")
              : text(
                  "แค็ตตาล็อกตามสิทธิ์การตลาดเดิม",
                  "Existing authorized marketing catalog",
                )}
        </p>
        <p>
          {text("อ่านเมื่อ", "Read at")}: {dateText(i.capturedAt)} ·{" "}
          {text("แหล่งข้อมูล", "Source")}: {i.source}
        </p>
        <Alert tone="warn">
          {text(
            "เวลาอ่านไม่ใช่เวลาซิงก์ต้นทาง ความสดใหม่ยังไม่ยืนยัน",
            "Read time is not upstream synchronization time. Freshness remains unverified.",
          )}
        </Alert>
        {i.kind === "sales_work" ? (
          <>
            <p>
              {text(
                "ผู้รับผิดชอบที่ต้นทางบันทึกไว้",
                "Source-recorded assignee",
              )}
              : {i.subject.assignedRepId ?? text("ยังไม่ยืนยัน", "Unverified")}
            </p>
            <p>
              {text(
                "ประวัติออเดอร์ที่อ่านได้ในหน้านี้",
                "Orders returned on this history page",
              )}
              : {i.orders.length}
              {i.historyHasMore
                ? text(
                    " · มีหน้าถัดไป ข้อมูลนี้ไม่ใช่ประวัติทั้งหมด",
                    " · More history exists; this is not complete history",
                  )
                : ""}
            </p>
            <p>
              {text(
                "รายการเดิมที่เลือกทบทวนได้",
                "Unambiguous historical lines available",
              )}
              : {i.historicalLines.length}
            </p>
          </>
        ) : (
          <dl className="grid gap-3 sm:grid-cols-2">
            <div>
              <dt>{text("สถานะที่บันทึกไว้", "Recorded status")}</dt>
              <dd>{i.product?.status ?? text("ไม่ทราบ", "Unknown")}</dd>
            </div>
            <div>
              <dt>{text("ราคาขายที่บันทึกไว้", "Recorded sale price")}</dt>
              <dd>{i.product?.recordedPrice ?? text("ไม่ทราบ", "Unknown")}</dd>
            </div>
            <div>
              <dt>
                {text(
                  "สต็อกที่บันทึกไว้ (ไม่ใช่พร้อมขายสด)",
                  "Recorded stock (not live availability)",
                )}
              </dt>
              <dd>{i.product?.recordedStock ?? text("ไม่ทราบ", "Unknown")}</dd>
            </div>
            <div>
              <dt>{text("จำนวนรูปที่บันทึกไว้", "Recorded image count")}</dt>
              <dd>{i.product?.imageCount ?? text("ไม่ทราบ", "Unknown")}</dd>
            </div>
            <div>
              <dt>{text("หน่วยขายที่บันทึกไว้", "Recorded selling unit")}</dt>
              <dd>{i.product?.sellingUnit ?? text("ไม่ทราบ", "Unknown")}</dd>
            </div>
            <div>
              <dt>
                {text("สินค้าต้นทางเปลี่ยนเมื่อ", "Source product changed at")}
              </dt>
              <dd>
                {i.product?.sourceChangedAt
                  ? dateText(i.product.sourceChangedAt)
                  : text("ไม่ทราบ", "Unknown")}
              </dd>
            </div>
          </dl>
        )}
        {i.knownReasons.length > 0 && (
          <>
            <p className="font-medium">
              {text("ประเด็นที่พบจากข้อมูล", "Recorded findings")}
            </p>
            <ul className="list-disc pl-5 space-y-2">
              {i.knownReasons.map((r) => (
                <li key={r}>{evidenceLabel(r)}</li>
              ))}
            </ul>
          </>
        )}
        <p className="font-medium">
          {text(
            "ข้อมูลที่ยังไม่มีสัญญาข้อมูลยืนยัน",
            "Source contracts still unavailable",
          )}
        </p>
        <ul className="list-disc pl-5 space-y-2">
          {i.missing.map((r) => (
            <li key={r}>
              {evidenceLabel(r)} · {text("ยังไม่ยืนยัน", "Unverified")}
            </li>
          ))}
        </ul>
        <p>
          {text(
            "Margin, ROAS และยอดออเดอร์ปัจจุบันยังไม่มีข้อมูลยืนยัน",
            "Margin, ROAS and current order totals remain unavailable.",
          )}
        </p>
      </div>
    </Panel>
  );
}
export function PlanEvidence({ value: v }: { value: PlanPreview }) {
  return (
    <>
      <Panel>
        <PanelHead
          title={text("ร่างสำหรับคนทบทวน", "Draft for human review")}
        />
        <div className="p-4 min-w-0 break-words space-y-3">
          <Chip tone={v.preview.readiness === "blocked" ? "warn" : "muted"}>
            {v.preview.readiness === "blocked"
              ? text("มีประเด็นต้องตรวจ", "Recorded issues require review")
              : text(
                  "ต้องยืนยันข้อมูลเพิ่มเติม",
                  "Further confirmation required",
                )}
          </Chip>
          <p>{v.scenario.name}</p>
          <p>
            {text("เหตุผลและงานที่เสนอ", "Reason and proposed work")}:{" "}
            {v.scenario.note}
          </p>
          {v.scenario.dueDate && (
            <p>
              {text(
                "วันที่ทบทวนที่ฉันเลือก (UTC)",
                "My chosen review date (UTC)",
              )}
              : {v.scenario.dueDate}
            </p>
          )}
          {v.scenario.lines.map((l) => (
            <p key={l.sku}>
              {l.sku} · {text("ปริมาณที่ฉันเสนอ", "My proposed quantity")}:{" "}
              {l.proposedQuantity} ·{" "}
              {text("หน่วยเดิมยังไม่ยืนยัน", "Historical unit unverified")}
            </p>
          ))}
          <Alert tone="muted">
            {text(
              "เก็บเป็นร่างส่วนตัวเพื่อทบทวนเท่านั้น ขั้นตอนนี้ยังไม่ส่งข้อความ สร้างออเดอร์ หรือเปิดใช้แคมเปญ",
              "Retained as a private human-reviewed draft. This workflow does not send messages, place orders or activate campaigns.",
            )}
          </Alert>
        </div>
      </Panel>
      <PlanSources inputs={v.inputs} />
    </>
  );
}
