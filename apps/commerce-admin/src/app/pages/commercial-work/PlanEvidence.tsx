import {
  Alert,
  Chip,
  DetailSection,
  KeyValueGrid,
  Panel,
  PanelHead,
  statusLabel,
} from "@cp/ui";
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
    "สินค้าซ้ำในออเดอร์ ต้องตรวจแยกก่อนเลือก",
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
const sourceLabels: Record<string, [string, string]> = {
  replica: ["ข้อมูลสำรองของร้านค้า", "Shop data backup"],
  copies: ["สำเนาในระบบของเรา", "Our stored copies"],
  mixed: [
    "ข้อมูลสำรองของร้านค้าและสำเนาในระบบของเรา",
    "Shop data backup and our stored copies",
  ],
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
      <div className="p-4 min-w-0 break-words space-y-4">
        <KeyValueGrid
          cols={2}
          items={[
            {
              label:
                i.kind === "sales_work"
                  ? text("บริษัท", "Company")
                  : text("สินค้า", "Product"),
              value: i.subject.name,
            },
            {
              label:
                i.kind === "sales_work"
                  ? text("รหัสบริษัท", "Company id")
                  : text("รหัสสินค้า", "Product code"),
              value: i.subject.id,
              mono: true,
            },
            {
              label: text("ขอบเขต", "Scope"),
              value:
                i.scope === "own_assigned_company"
                  ? text(
                      "บริษัทที่ฉันรับผิดชอบตามต้นทาง",
                      "My source-authorized assigned companies",
                    )
                  : i.scope === "authorized_team_company"
                    ? text(
                        "บริษัทของทีมตามสิทธิ์เดิม",
                        "Authorized team companies",
                      )
                    : text(
                        "แค็ตตาล็อกตามสิทธิ์การตลาดเดิม",
                        "Existing authorized marketing catalog",
                      ),
            },
            {
              label: text("อ่านเมื่อ", "Read at"),
              value: dateText(i.capturedAt),
            },
            {
              label: text("แหล่งข้อมูล", "Source"),
              value: sourceLabels[i.source]
                ? text(...sourceLabels[i.source])
                : i.source,
            },
            ...(i.kind === "sales_work"
              ? [
                  {
                    label: text(
                      "ผู้รับผิดชอบที่ต้นทางบันทึกไว้",
                      "Source-recorded assignee",
                    ),
                    value:
                      i.subject.assignedRepId ??
                      text("ยังไม่ยืนยัน", "Unverified"),
                    mono: !!i.subject.assignedRepId,
                  },
                  {
                    label: text(
                      "ประวัติออเดอร์ที่อ่านได้ในหน้านี้",
                      "Orders returned on this history page",
                    ),
                    value: (
                      <>
                        <span className="tabular-nums">{i.orders.length}</span>
                        {i.historyHasMore
                          ? text(
                              " · มีหน้าถัดไป ข้อมูลนี้ไม่ใช่ประวัติทั้งหมด",
                              " · More history exists; this is not complete history",
                            )
                          : ""}
                      </>
                    ),
                  },
                  {
                    label: text(
                      "รายการเดิมที่เลือกทบทวนได้",
                      "Unambiguous historical lines available",
                    ),
                    value: (
                      <span className="tabular-nums">
                        {i.historicalLines.length}
                      </span>
                    ),
                  },
                ]
              : [
                  {
                    label: text("สถานะที่บันทึกไว้", "Recorded status"),
                    value: i.product?.status
                      ? statusLabel(i.product.status)
                      : text("ไม่ทราบ", "Unknown"),
                  },
                  {
                    label: text("ราคาขายที่บันทึกไว้", "Recorded sale price"),
                    value: (
                      <span className="tabular-nums">
                        {i.product?.recordedPrice ?? text("ไม่ทราบ", "Unknown")}
                      </span>
                    ),
                  },
                  {
                    label: text(
                      "สต็อกที่บันทึกไว้ (ไม่ใช่พร้อมขายสด)",
                      "Recorded stock (not live availability)",
                    ),
                    value: (
                      <span className="tabular-nums">
                        {i.product?.recordedStock ?? text("ไม่ทราบ", "Unknown")}
                      </span>
                    ),
                  },
                  {
                    label: text("จำนวนรูปที่บันทึกไว้", "Recorded image count"),
                    value: (
                      <span className="tabular-nums">
                        {i.product?.imageCount ?? text("ไม่ทราบ", "Unknown")}
                      </span>
                    ),
                  },
                  {
                    label: text(
                      "หน่วยขายที่บันทึกไว้",
                      "Recorded selling unit",
                    ),
                    value: i.product?.sellingUnit ?? text("ไม่ทราบ", "Unknown"),
                  },
                  {
                    label: text(
                      "สินค้าต้นทางเปลี่ยนเมื่อ",
                      "Source product changed at",
                    ),
                    value: i.product?.sourceChangedAt
                      ? dateText(i.product.sourceChangedAt)
                      : text("ไม่ทราบ", "Unknown"),
                  },
                ]),
          ]}
        />
        <Alert tone="warn">
          {text(
            "เวลาอ่านไม่ใช่เวลาอัปเดตจากต้นทาง ความสดใหม่ยังไม่ยืนยัน",
            "Read time is not upstream synchronization time. Freshness remains unverified.",
          )}
        </Alert>
        {i.knownReasons.length > 0 && (
          <DetailSection
            title={text("ประเด็นที่พบจากข้อมูล", "Recorded findings")}
          >
            <ul className="list-disc pl-5 space-y-1.5 text-sm">
              {i.knownReasons.map((r) => (
                <li key={r}>{evidenceLabel(r)}</li>
              ))}
            </ul>
          </DetailSection>
        )}
        <DetailSection
          title={text(
            "ข้อมูลที่ยังยืนยันจากต้นทางไม่ได้",
            "Source contracts still unavailable",
          )}
        >
          <ul className="list-disc pl-5 space-y-1.5 text-sm">
            {i.missing.map((r) => (
              <li key={r}>
                {evidenceLabel(r)} · {text("ยังไม่ยืนยัน", "Unverified")}
              </li>
            ))}
          </ul>
        </DetailSection>
        <p className="text-sm text-on-surface-variant">
          {text(
            "กำไรขั้นต้น ผลตอบแทนค่าโฆษณา และยอดออเดอร์ปัจจุบันยังไม่มีข้อมูลยืนยัน",
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
          badge={
            <Chip
              tone={v.preview.readiness === "blocked" ? "warn" : "muted"}
              dot
            >
              {v.preview.readiness === "blocked"
                ? text("มีประเด็นต้องตรวจ", "Recorded issues require review")
                : text(
                    "ต้องยืนยันข้อมูลเพิ่มเติม",
                    "Further confirmation required",
                  )}
            </Chip>
          }
        />
        <div className="p-4 min-w-0 break-words space-y-4">
          <KeyValueGrid
            cols={2}
            items={[
              {
                label: text("ชื่อร่างงาน", "Work draft name"),
                value: v.scenario.name,
              },
              {
                label: text(
                  "วันที่ทบทวนที่ฉันเลือก (UTC)",
                  "My chosen review date (UTC)",
                ),
                value: v.scenario.dueDate,
              },
              {
                label: text("เหตุผลและงานที่เสนอ", "Reason and proposed work"),
                value: v.scenario.note,
                wide: true,
              },
            ]}
          />
          {v.scenario.lines.length > 0 && (
            <DetailSection title={text("รายการที่เสนอ", "Proposed lines")}>
              <ul className="space-y-1.5 text-sm">
                {v.scenario.lines.map((l) => (
                  <li key={l.sku}>
                    <span className="font-mono text-xs">{l.sku}</span> ·{" "}
                    {text("ปริมาณที่ฉันเสนอ", "My proposed quantity")}:{" "}
                    <span className="tabular-nums">{l.proposedQuantity}</span> ·{" "}
                    {text(
                      "หน่วยเดิมยังไม่ยืนยัน",
                      "Historical unit unverified",
                    )}
                  </li>
                ))}
              </ul>
            </DetailSection>
          )}
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
