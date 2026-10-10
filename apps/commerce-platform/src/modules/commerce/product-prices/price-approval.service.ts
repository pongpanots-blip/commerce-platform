import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { createHash, randomUUID } from "node:crypto";
import { DataSource, EntityManager } from "typeorm";
import { Paged, QueuePage, queueList } from "../queue-page";
import { ProductPricesService, ownsPrices } from "./product-prices.service";
import {
  priceApprovalItemSchema,
  priceApprovalPacketSchema,
  priceApprovalReviewSchema,
  priceApprovalSelectionSchema,
  priceRequestId,
  verifyPriceApprovalReceipt,
  type PriceApprovalItem,
} from "./price-approval-contracts";
const hash = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
const select = `q.product_inventory_sku AS sku, q.selling_unit_price, q.ordering_price, q.moq,
 q.changed_at, q.received_at, q.changed_at::text AS changed_stamp, q.received_at::text AS received_stamp, q.xmin::text AS pending_stamp,
 p.product_inventory_sku IS NOT NULL AS recorded, p.selling_unit_price AS current_selling_unit_price,
 p.ordering_price AS current_ordering_price, p.moq AS current_moq, p.source AS current_source,
 p.updated_by AS current_updated_by, p.updated_at::text AS current_updated_at, p.xmin::text AS current_stamp`;
const from =
  "product_price_pending q LEFT JOIN product_prices p USING (product_inventory_sku)";
type Raw = Record<string, unknown>;
@Injectable()
export class PriceApprovalService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly prices: ProductPricesService,
  ) {}
  private parse<T>(schema: { parse(v: unknown): T }, value: unknown): T {
    try {
      return schema.parse(value);
    } catch {
      throw new BadRequestException(
        "Invalid price review scope or request. Choose 1–100 unique SKUs.",
      );
    }
  }
  private async available<T>(run: () => Promise<T>) {
    try {
      return await run();
    } catch (e) {
      if (e instanceof HttpException) throw e;
      throw new ServiceUnavailableException(
        "Price evidence or receipt storage unavailable. Check the original request before retrying.",
      );
    }
  }
  private actor(actor: string) {
    if (!actor || actor.length > 128)
      throw new BadRequestException("Invalid staff identity");
  }
  private item(row: Raw): PriceApprovalItem {
    const values = (prefix: string) => ({
      sellingUnitPrice: row[prefix + "selling_unit_price"],
      orderingPrice: row[prefix + "ordering_price"],
      moq: row[prefix + "moq"],
    });
    return priceApprovalItemSchema.parse({
      sku: row.sku,
      version: hash(row),
      current: values("current_"),
      proposed: values(""),
      currentRecorded: row.recorded,
      currentSource: row.current_source,
      currentUpdatedAt: row.current_updated_at,
      currentUpdatedBy: row.current_updated_by,
      changedAt: row.changed_at
        ? new Date(String(row.changed_at)).toISOString()
        : null,
      receivedAt: new Date(String(row.received_at)).toISOString(),
    });
  }
  async pending(search: string | undefined, paging: QueuePage) {
    return this.available(async () => {
      const page = (await queueList<Raw>(
        this.db,
        {
          select,
          from: `${from} WHERE $1::text IS NULL OR q.product_inventory_sku ILIKE '%' || $1 || '%'`,
          order: "q.received_at DESC,q.product_inventory_sku",
        },
        [search?.trim() || null],
        paging,
        500,
      )) as Paged<Raw>;
      return {
        ...page,
        items: page.items.map((i) => this.item(i)),
        ownership: ownsPrices() ? "commerce" : "josh",
      };
    });
  }
  private async state(m: EntityManager, skus: string[]) {
    const rows: Raw[] = await m.query(
      `SELECT ${select} FROM ${from} WHERE q.product_inventory_sku=ANY($1::text[]) ORDER BY q.product_inventory_sku`,
      [skus],
    );
    return skus.map((sku) => {
      const row = rows.find((r) => r.sku === sku);
      if (!row)
        throw new ConflictException(
          `Pending price for ${sku} changed or is no longer available. Review the current queue.`,
        );
      return this.item(row);
    });
  }
  async itemFor(sku: string) {
    if (!sku || Array.from(sku).length > 64)
      throw new BadRequestException("Invalid SKU");
    return this.available(async () =>
      priceApprovalReviewSchema.parse({
        items: await this.state(this.db.manager, [sku]),
        ownership: ownsPrices() ? "commerce" : "josh",
        capturedAt: new Date().toISOString(),
      }),
    );
  }
  async review(raw: unknown) {
    const input = this.parse(priceApprovalSelectionSchema, raw);
    return this.available(async () => {
      const items = await this.state(
        this.db.manager,
        input.changes.map((i) => i.sku),
      );
      if (items.some((i, n) => i.version !== input.changes[n].version))
        throw new ConflictException(
          "Selected pending or current prices changed. Review the current queue; no decision was saved.",
        );
      return priceApprovalReviewSchema.parse({
        items,
        ownership: ownsPrices() ? "commerce" : "josh",
        capturedAt: new Date().toISOString(),
      });
    });
  }
  async request(id: string, actor: string) {
    this.actor(actor);
    this.parse(priceRequestId, id);
    return this.available(async () => {
      const [row] = await this.db.query(
        "SELECT receipt FROM commerce_promotion_draft_requests WHERE actor_id=$1 AND request_id=$2 AND receipt->'scenario'->>'kind'='product_price_approval'",
        [actor, id],
      );
      if (!row)
        throw new NotFoundException(
          "Committed price decision not found for this account",
        );
      return verifyPriceApprovalReceipt(row.receipt);
    });
  }
  async save(raw: unknown, actor: string) {
    const packet = this.parse(priceApprovalPacketSchema, raw);
    this.actor(actor);
    return this.available(() =>
      this.db.transaction(async (m) => {
        await m.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          `promotion-draft:${actor}:${packet.requestId}`,
        ]);
        const [previous] = await m.query(
          "SELECT request_hash,receipt FROM commerce_promotion_draft_requests WHERE actor_id=$1 AND request_id=$2",
          [actor, packet.requestId],
        );
        if (previous) {
          if (previous.request_hash !== hash(packet))
            throw new ConflictException(
              "Request ID already identifies a different decision",
            );
          return {
            ...verifyPriceApprovalReceipt(previous.receipt, packet),
            replayed: true,
          };
        }
        if (!ownsPrices())
          throw new ConflictException(
            "Prices are still owned by Josh. Commerce cannot approve or reject them.",
          );
        const skus = packet.changes.map((i) => i.sku);
        await m.query(
          "SELECT product_inventory_sku FROM product_price_pending WHERE product_inventory_sku=ANY($1::text[]) ORDER BY product_inventory_sku FOR UPDATE",
          [skus],
        );
        // The native writer shares these locks, including the absent-current-row case.
        for (const sku of [...skus].sort())
          await m.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
            `product-price:${sku}`,
          ]);
        await m.query(
          "SELECT product_inventory_sku FROM product_prices WHERE product_inventory_sku=ANY($1::text[]) ORDER BY product_inventory_sku FOR UPDATE",
          [skus],
        );
        const before = await this.state(m, skus);
        if (before.some((i, n) => i.version !== packet.changes[n].version))
          throw new ConflictException(
            "Pending or current prices changed. No selected decisions were saved. Review again.",
          );
        // Preserve native all-or-nothing approval and null=unchanged semantics, including the same event bus/outbox.
        const count =
          packet.decision === "approve"
            ? (await this.prices.approveWithin(m, skus, actor)).approved
            : (await this.prices.rejectWithin(m, skus)).rejected;
        if (count !== skus.length)
          throw new ConflictException(
            "Incomplete native result. All selected decisions rolled back.",
          );
        const after: Raw[] = await m.query(
          "SELECT product_inventory_sku AS sku,selling_unit_price,ordering_price,moq FROM product_prices WHERE product_inventory_sku=ANY($1::text[])",
          [skus],
        );
        const id = randomUUID(),
          savedAt = new Date().toISOString();
        const receipt = verifyPriceApprovalReceipt(
          {
            kind: "product_price_approval",
            scenario: { kind: "product_price_approval" },
            id,
            requestId: packet.requestId,
            packet,
            status: "committed",
            persisted: true,
            appliedCount: count,
            savedAt,
            outboxEnqueued: packet.decision === "approve",
            downstreamDelivery:
              packet.decision === "approve" ? "unverified" : "not_applicable",
            items: before.map((item) => {
              const row = after.find((r) => r.sku === item.sku);
              return {
                before: item,
                after: {
                  sellingUnitPrice: row?.selling_unit_price ?? null,
                  orderingPrice: row?.ordering_price ?? null,
                  moq: row?.moq ?? null,
                },
                outcome:
                  packet.decision === "approve" ? "approved" : "rejected",
              };
            }),
          },
          packet,
        );
        await m.query(
          "INSERT INTO commerce_promotion_drafts(id,actor_id,revision,scenario,evidence,preview) VALUES($1,$2,1,$3,$4,$5)",
          [
            id,
            actor,
            JSON.stringify({ kind: "product_price_approval", packet }),
            JSON.stringify({ items: before }),
            JSON.stringify(receipt),
          ],
        );
        await m.query(
          "INSERT INTO commerce_promotion_draft_requests(actor_id,request_id,request_hash,draft_id,receipt) VALUES($1,$2,$3,$4,$5)",
          [actor, packet.requestId, hash(packet), id, JSON.stringify(receipt)],
        );
        return { ...receipt, replayed: false };
      }),
    );
  }
}
