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
import { ProductPricesService, ownsPrices } from "./product-prices.service";
import {
  editedPriceValues,
  manualPriceItemSchema,
  manualPricePacketSchema,
  manualPriceSelectionSchema,
  manualPriceSkuSchema,
  verifyManualPriceReceipt,
  type ManualPriceItem,
  type ManualPriceSelection,
} from "./manual-price-contracts";
import { priceRequestId } from "./price-approval-contracts";
const hash = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
@Injectable()
export class ManualPriceService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly prices: ProductPricesService,
  ) {}
  private parse<T>(schema: { parse(v: unknown): T }, v: unknown): T {
    try {
      return schema.parse(v);
    } catch {
      throw new BadRequestException(
        "Invalid price edit. Choose fields to keep, set or clear.",
      );
    }
  }
  private async available<T>(run: () => Promise<T>) {
    try {
      return await run();
    } catch (e) {
      if (e instanceof HttpException) throw e;
      throw new ServiceUnavailableException(
        "Price evidence or outcome storage unavailable. Check the original request before retrying.",
      );
    }
  }
  private actor(actor: string) {
    if (
      typeof actor !== "string" ||
      !actor.trim() ||
      actor.includes("\u0000") ||
      Array.from(actor).length > 128
    )
      throw new BadRequestException("Invalid staff identity");
  }
  private async state(m: EntityManager, sku: string): Promise<ManualPriceItem> {
    const [row] = await m.query(
      `SELECT product_inventory_sku AS sku,selling_unit_price,ordering_price,moq,source,updated_by,updated_at::text AS updated_at,xmin::text AS stamp FROM product_prices WHERE product_inventory_sku=$1`,
      [sku],
    );
    let catalog;
    if (!row) {
      [catalog] = await m.query(
        "SELECT sku,xmin::text AS stamp FROM josh_catalog_products WHERE sku=$1",
        [sku],
      );
      if (!catalog)
        throw new NotFoundException(
          "Known product not found. No price can be edited.",
        );
    }
    return manualPriceItemSchema.parse({
      sku,
      version: hash(row ?? { catalog }),
      current: {
        sellingUnitPrice: row?.selling_unit_price ?? null,
        orderingPrice: row?.ordering_price ?? null,
        moq: row?.moq ?? null,
      },
      currentRecorded: !!row,
      currentSource: row?.source ?? null,
      currentUpdatedAt: row?.updated_at ?? null,
      currentUpdatedBy: row?.updated_by ?? null,
    });
  }
  async itemFor(sku: string) {
    if (!manualPriceSkuSchema.safeParse(sku).success)
      throw new BadRequestException("Invalid SKU");
    return this.available(async () => ({
      item: await this.state(this.db.manager, sku),
      ownership: ownsPrices() ? "commerce" : "josh",
    }));
  }
  private async evidence(m: EntityManager, input: ManualPriceSelection) {
    const item = await this.state(m, input.sku);
    if (item.version !== input.version)
      throw new ConflictException(
        "Current price changed. No edit was saved. Review current values again.",
      );
    return {
      item,
      patch: input.patch,
      after: editedPriceValues(item, input.patch),
      ownership: ownsPrices() ? ("commerce" as const) : ("josh" as const),
      capturedAt: new Date().toISOString(),
    };
  }
  async review(raw: unknown) {
    const input = this.parse(manualPriceSelectionSchema, raw);
    return this.available(() => this.evidence(this.db.manager, input));
  }
  async request(id: string, actor: string) {
    this.actor(actor);
    const requestId = this.parse(priceRequestId, id);
    return this.available(async () => {
      const [r] = await this.db.query(
        "SELECT draft_id,receipt FROM commerce_promotion_draft_requests WHERE actor_id=$1 AND request_id=$2 AND receipt->'scenario'->>'kind'='product_price_edit'",
        [actor, requestId],
      );
      if (!r)
        throw new NotFoundException(
          "Committed price edit not found for this account",
        );
      const receipt = verifyManualPriceReceipt(r.receipt);
      if (
        receipt.updatedBy !== actor ||
        receipt.requestId !== requestId ||
        receipt.id !== r.draft_id
      )
        throw Error("Receipt identity differs from its persisted request");
      return receipt;
    });
  }
  async save(raw: unknown, actor: string) {
    const packet = this.parse(manualPricePacketSchema, raw);
    this.actor(actor);
    return this.available(() =>
      this.db.transaction(async (m) => {
        await m.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          `promotion-draft:${actor}:${packet.requestId}`,
        ]);
        const [previous] = await m.query(
          "SELECT request_hash,draft_id,receipt FROM commerce_promotion_draft_requests WHERE actor_id=$1 AND request_id=$2",
          [actor, packet.requestId],
        );
        if (previous) {
          if (
            previous.request_hash !==
            hash({ kind: "product_price_edit", packet })
          )
            throw new ConflictException(
              "Request ID already identifies a different action",
            );
          const receipt = verifyManualPriceReceipt(previous.receipt, packet);
          if (receipt.updatedBy !== actor || receipt.id !== previous.draft_id)
            throw Error("Receipt identity differs from its persisted request");
          return { ...receipt, replayed: true };
        }
        if (!ownsPrices())
          throw new ConflictException(
            "Josh still owns prices. No edit can be saved here.",
          );
        // Shared with every native writer, including absent-current-row creation.
        await m.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          `product-price:${packet.sku}`,
        ]);
        await m.query(
          "SELECT product_inventory_sku FROM product_prices WHERE product_inventory_sku=$1 FOR UPDATE",
          [packet.sku],
        );
        const review = await this.evidence(m, packet);
        await this.prices.editWithin(m, packet.sku, packet.patch, actor);
        const saved = await this.state(m, packet.sku),
          after = saved.current;
        if (saved.currentSource !== "staff" || saved.currentUpdatedBy !== actor)
          throw Error("Native saved provenance differs from requested edit");
        const id = randomUUID(),
          savedAt = new Date().toISOString();
        const receipt = verifyManualPriceReceipt(
          {
            kind: "product_price_edit",
            scenario: { kind: "product_price_edit" },
            id,
            requestId: packet.requestId,
            packet,
            status: "committed",
            persisted: true,
            savedAt,
            before: review.item,
            after,
            appliedCount: 1,
            source: "staff",
            updatedBy: actor,
            outboxEnqueued: true,
            downstreamDelivery: "unverified",
          },
          packet,
        );
        await m.query(
          "INSERT INTO commerce_promotion_drafts(id,actor_id,revision,scenario,evidence,preview) VALUES($1,$2,1,$3,$4,$5)",
          [
            id,
            actor,
            JSON.stringify({ kind: "product_price_edit", packet }),
            JSON.stringify(review),
            JSON.stringify(receipt),
          ],
        );
        await m.query(
          "INSERT INTO commerce_promotion_draft_requests(actor_id,request_id,request_hash,draft_id,receipt) VALUES($1,$2,$3,$4,$5)",
          [
            actor,
            packet.requestId,
            hash({ kind: "product_price_edit", packet }),
            id,
            JSON.stringify(receipt),
          ],
        );
        return { ...receipt, replayed: false };
      }),
    );
  }
}
