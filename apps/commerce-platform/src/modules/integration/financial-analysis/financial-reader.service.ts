import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import { JoshReplica } from "../connector/josh/josh-replica";
import {
  JOSH_SETTLED_STATUSES,
  paidOrderSql,
  salesSource,
} from "../connector/josh/josh-insights";
import {
  fields,
  financeDetailSchema,
  financePeriodSchema,
  monthWindow,
  orderEvidenceSchema,
  refundEvidenceSchema,
  type FinancePeriod,
} from "./financial-analysis";
export function financialSql(
  source: "replica" | "copies",
  kind: "orders" | "refunds",
  detail = false,
) {
  const copies = source === "copies",
    orders = copies ? "josh_orders" : "orders",
    refunds = copies ? "josh_order_refunds" : "order_refunds",
    paid = copies ? "o.paid" : paidOrderSql("o");
  const orderColumns = `o.orders_id AS id,o.order_number AS number,o.status::text AS status,o.create_date AS "createdAt",jsonb_build_object(${fields.map((f) => `'${f}',o.${f}::text`).join(",")}) AS values,${copies ? "o.copied_at" : "NULL::timestamptz"} AS "copiedAt",${copies ? "o.source_version::text" : "NULL::text"} AS "sourceVersion"`;
  if (kind === "orders") {
    const base = `FROM ${orders} o WHERE o.create_date >= $1::timestamptz AND o.create_date < $2::timestamptz AND o.status::text=ANY($3::text[]) AND ${paid}`;
    if (detail)
      return `SELECT ${orderColumns} ${base} AND o.orders_id=$4::uuid`;
    return `WITH eligible AS (SELECT o.* ${base}), sample AS (SELECT ${orderColumns} FROM eligible o ORDER BY o.create_date DESC,o.orders_id LIMIT 20) SELECT jsonb_build_object('paidOrders',count(*)::int,'excludedWithoutPayment',(SELECT count(*)::int FROM ${orders} o WHERE o.create_date >= $1::timestamptz AND o.create_date < $2::timestamptz AND o.status::text=ANY($3::text[]) AND NOT (${paid})),'legacyCopyOrders',${copies ? "count(*) FILTER(WHERE o.source_version=0)::int" : "NULL"},'latestCopyWriteAt',${copies ? "max(o.copied_at)" : "NULL"},'values',jsonb_build_object(${fields.map((f) => `'${f}',jsonb_build_object('knownSum',sum(o.${f})::text,'knownRows',count(o.${f})::int,'negativeRows',count(*) FILTER(WHERE o.${f}<0)::int)`).join(",")}),'items',(SELECT COALESCE(jsonb_agg(s ORDER BY s."createdAt" DESC,s.id),'[]'::jsonb) FROM sample s)) AS evidence FROM eligible o`;
  }
  const foreign = copies ? "r.orders_id" : "r.order_id",
    columns = `r.id,${foreign} AS "orderId",r.amount::text AS amount,r.created_at AS "createdAt",r.processed_at AS "processedAt",o.create_date AS "orderCreatedAt"`,
    base = `FROM ${refunds} r LEFT JOIN ${orders} o ON o.orders_id=${foreign} WHERE r.status::text='refunded' AND r.created_at >= $1::timestamptz AND r.created_at < $2::timestamptz`;
  if (detail)
    return `SELECT ${columns} ${base} AND ${foreign}=$3::uuid AND r.id=$4::uuid`;
  return `WITH eligible AS(SELECT ${columns} ${base}),sample AS(SELECT * FROM eligible ORDER BY "createdAt" DESC,"orderId",id LIMIT 20) SELECT jsonb_build_object('records',count(*)::int,'knownAmount',sum(amount::numeric)::text,'knownRows',count(amount)::int,'negativeRows',count(*) FILTER(WHERE amount::numeric<0)::int,'unlinkedOrders',count(*) FILTER(WHERE "orderCreatedAt" IS NULL)::int,'outsideOrderPeriod',count(*) FILTER(WHERE "orderCreatedAt"<$1::timestamptz OR "orderCreatedAt">=$2::timestamptz)::int,'items',(SELECT COALESCE(jsonb_agg(s ORDER BY s."createdAt" DESC,s."orderId",s.id),'[]'::jsonb) FROM sample s)) AS evidence FROM eligible`;
}
@Injectable()
export class FinancialReaderService {
  constructor(
    private readonly replica: JoshReplica,
    @InjectDataSource() private readonly db: DataSource,
  ) {}
  get source() {
    return salesSource();
  }
  get available() {
    return this.source === "copies" || this.replica.configured;
  }
  private read(source: "copies" | "replica", sql: string, args: unknown[]) {
    return source === "copies"
      ? this.db.query(sql, args)
      : this.replica.query(sql, args);
  }
  async period(
    rawMonth: string,
    timezone: "UTC" | "Asia/Bangkok",
  ): Promise<FinancePeriod> {
    const source = this.source,
      window = monthWindow(rawMonth, timezone),
      capturedAt = new Date().toISOString();
    const results = this.available
      ? await Promise.allSettled([
          this.read(source, financialSql(source, "orders"), [
            window.from,
            window.to,
            JOSH_SETTLED_STATUSES,
          ]),
          this.read(source, financialSql(source, "refunds"), [
            window.from,
            window.to,
          ]),
        ])
      : [];
    let orders = null,
      refunds = null;
    try {
      const r = results[0];
      if (r?.status === "fulfilled") {
        const v = r.value[0].evidence;
        orders = {
          ...v,
          values: Object.fromEntries(
            fields.map((f) => {
              const x = v.values[f];
              return [
                f,
                {
                  ...x,
                  missingRows: v.paidOrders - x.knownRows,
                  value:
                    v.paidOrders === 0
                      ? "0.00"
                      : x.knownRows === v.paidOrders
                        ? x.knownSum
                        : null,
                },
              ];
            }),
          ),
          hasMore: v.paidOrders > v.items.length,
        };
      }
    } catch {}
    try {
      const r = results[1];
      if (r?.status === "fulfilled") {
        const v = r.value[0].evidence;
        refunds = {
          ...v,
          missingRows: v.records - v.knownRows,
          hasMore: v.records > v.items.length,
        };
      }
    } catch {}
    // Validate each source independently; a malformed refund does not conceal valid order coverage.
    const base = {
      window,
      source,
      declaredCurrency: "THB" as const,
      currencyEvidence: "native_report_contract" as const,
      unitBasis: "order_header_amount" as const,
      orderTimeBasis: "order_create_date" as const,
      refundTimeBasis: "refund_created_at" as const,
      upstreamCompleteness: "unverified" as const,
      upstreamFreshness: "unverified" as const,
      capturedAt,
    };
    for (const kind of ["orders", "refunds"] as const) {
      const candidate = {
        ...base,
        orders: kind === "orders" ? orders : null,
        refunds: kind === "refunds" ? refunds : null,
        issues:
          kind === "orders"
            ? ["refunds_unavailable", ...(orders ? [] : ["orders_unavailable"])]
            : [
                "orders_unavailable",
                ...(refunds ? [] : ["refunds_unavailable"]),
              ],
        coverage:
          (kind === "orders" && orders) || (kind === "refunds" && refunds)
            ? "partial"
            : "unavailable",
      };
      if (!financePeriodSchema.safeParse(candidate).success) {
        if (kind === "orders") orders = null;
        else refunds = null;
      }
    }
    return financePeriodSchema.parse({
      ...base,
      orders,
      refunds,
      issues: [
        ...(orders ? [] : ["orders_unavailable"]),
        ...(refunds ? [] : ["refunds_unavailable"]),
      ],
      coverage: orders || refunds ? "partial" : "unavailable",
    });
  }
  async detail(
    kind: "orders" | "refunds",
    month: string,
    timezone: "UTC" | "Asia/Bangkok",
    id: string,
    orderId?: string,
  ) {
    if (!this.available)
      throw new ServiceUnavailableException(
        "Financial source unavailable. Retry the original authorized read.",
      );
    const source = this.source,
      w = monthWindow(month, timezone);
    let rows;
    try {
      rows = await this.read(
        source,
        financialSql(source, kind, true),
        kind === "orders"
          ? [w.from, w.to, JOSH_SETTLED_STATUSES, id]
          : [w.from, w.to, orderId, id],
      );
    } catch {
      throw new ServiceUnavailableException(
        "Financial source record unavailable. Refresh and retry.",
      );
    }
    if (!rows.length)
      throw new NotFoundException(
        "Record is absent from this source and period eligibility boundary.",
      );
    try {
      return financeDetailSchema.parse({
        kind,
        window: w,
        source,
        capturedAt: new Date().toISOString(),
        upstreamFreshness: "unverified",
        record:
          kind === "orders"
            ? orderEvidenceSchema.parse(normalizeRecord(rows[0]))
            : refundEvidenceSchema.parse(normalizeRecord(rows[0])),
      });
    } catch {
      throw new ServiceUnavailableException(
        "Financial source record could not be verified.",
      );
    }
  }
}

function normalizeRecord(r: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(r).map(([k, v]) => [
      k,
      v instanceof Date ? v.toISOString() : v,
    ]),
  );
}
