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
import {
  ProductContentsService,
  ownsProductContent,
} from "../product-contents/product-contents.service";
import { splitContent } from "../product-contents/content-fields";
import { priceRequestId } from "../product-prices/price-approval-contracts";
import {
  PRODUCT_CONTENT_EDIT_FIELDS,
  editedProductContentValues,
  productContentFieldsSchema,
  productContentItemSchema,
  productContentPacketSchema,
  productContentReviewSchema,
  productContentSelectionSchema,
  productContentUpdateSchema,
  productContentValuesSchema,
  verifyProductContentReceipt,
  type ProductContentItem,
  type ProductContentSelection,
} from "./product-content-editor-contracts";

const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
type Row = Record<string, any>;
@Injectable()
export class ProductContentEditorService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly content: ProductContentsService,
  ) {}

  private parse<T>(schema: { parse(value: unknown): T }, value: unknown): T {
    try {
      return schema.parse(value);
    } catch {
      throw new BadRequestException(
        "Invalid content edit. Choose only the six editable text fields and the original review identity.",
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
  private async available<T>(run: () => Promise<T>) {
    try {
      return await run();
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException(
        "Product content evidence or outcome storage unavailable. Check the original request before retrying.",
      );
    }
  }
  private fields(raw: unknown) {
    const fields = this.parse(productContentFieldsSchema, raw);
    // Keep the existing native rules authoritative as well as the strict six-key envelope.
    const native = splitContent(fields);
    if (
      Object.keys(native.rest).length ||
      JSON.stringify(native.content) !== JSON.stringify(fields)
    )
      throw new BadRequestException(
        "Content fields differ from the existing native rules",
      );
    return fields;
  }
  private current(raw: unknown) {
    if (raw == null || typeof raw !== "object" || Array.isArray(raw))
      throw Error("Invalid native content fields");
    const fields: Record<string, unknown> = {};
    for (const key of PRODUCT_CONTENT_EDIT_FIELDS)
      if (Object.prototype.hasOwnProperty.call(raw, key))
        fields[key] = (raw as Row)[key];
    return productContentValuesSchema.parse(fields);
  }
  private copiedFields(catalog: Row) {
    const fields: Record<string, unknown> = {};
    if (Array.isArray(catalog.translations))
      for (const language of ["th", "en"] as const) {
        const translations = catalog.translations.filter(
          (row: Row) => row?.language_code === language,
        );
        if (translations.length !== 1) continue;
        for (const field of ["product_name", "product_description"] as const)
          if (Object.prototype.hasOwnProperty.call(translations[0], field))
            fields[`${field}_${language}`] = translations[0][field];
      }
    return productContentValuesSchema.parse(fields);
  }
  private async state(
    m: EntityManager,
    productId: string,
    owned: boolean,
    locked = false,
  ): Promise<ProductContentItem> {
    const [catalog]: Row[] = await m.query(
      `SELECT id,sku,translations,removed_at,synced_at::text AS synced_at,xmin::text AS stamp FROM josh_catalog_products WHERE id=$1 AND removed_at IS NULL${locked ? " FOR SHARE" : ""}`,
      [productId],
    );
    if (!catalog)
      throw new NotFoundException(
        "Known product not found. No content can be edited.",
      );
    const mappings: Row[] = await m.query(
      `SELECT id FROM josh_catalog_products WHERE sku=$1 AND removed_at IS NULL${locked ? " FOR SHARE" : ""}`,
      [catalog.sku],
    );
    if (mappings.length !== 1 || mappings[0].id !== catalog.id)
      throw new ConflictException(
        "Product SKU identifies more than one catalog product. No content can be edited safely.",
      );
    const [row]: Row[] = await m.query(
      `SELECT fields,source,updated_by,updated_at::text AS updated_at,xmin::text AS stamp FROM product_contents WHERE product_inventory_sku=$1${locked ? " FOR UPDATE" : ""}`,
      [catalog.sku],
    );
    const copied = !owned && !row ? this.copiedFields(catalog) : undefined;
    return productContentItemSchema.parse({
      productId: catalog.id,
      sku: catalog.sku,
      version: hash({ catalog, row: row ?? null, owned }),
      current: row ? this.current(row.fields) : (copied ?? {}),
      currentRecorded: !!row,
      currentSource:
        row?.source ??
        (copied && Object.keys(copied).length ? "josh_catalog_snapshot" : null),
      currentUpdatedAt:
        row?.updated_at ??
        (copied && Object.keys(copied).length ? catalog.synced_at : null),
      currentUpdatedBy: row?.updated_by ?? null,
      evidenceSource: row
        ? owned
          ? "native"
          : "archived_native"
        : copied && Object.keys(copied).length
          ? "copied_snapshot"
          : "unavailable",
    });
  }
  async itemFor(rawProductId: string) {
    const productId = this.parse(priceRequestId, rawProductId),
      owned = ownsProductContent();
    return this.available(() =>
      this.db.transaction("REPEATABLE READ", async (m) => {
        await m.query("SET TRANSACTION READ ONLY");
        await m.query("SET LOCAL statement_timeout = '1500ms'");
        return {
          item: await this.state(m, productId, owned),
          ownership: owned ? ("commerce" as const) : ("josh" as const),
        };
      }),
    );
  }
  private async evidence(
    m: EntityManager,
    selection: ProductContentSelection,
    owned: boolean,
    locked = false,
  ) {
    const item = await this.state(m, selection.productId, owned, locked);
    if (item.sku !== selection.sku || item.version !== selection.version)
      throw new ConflictException(
        "Product identity or content changed. No edit was saved. Review current values again.",
      );
    return productContentReviewSchema.parse({
      item,
      fields: selection.fields,
      after: editedProductContentValues(item, selection.fields),
      ownership: owned ? "commerce" : "josh",
      capturedAt: new Date().toISOString(),
    });
  }
  async review(raw: unknown) {
    const selection = this.parse(productContentSelectionSchema, raw),
      owned = ownsProductContent();
    selection.fields = this.fields(selection.fields);
    return this.available(() =>
      this.db.transaction("REPEATABLE READ", async (m) => {
        await m.query("SET TRANSACTION READ ONLY");
        await m.query("SET LOCAL statement_timeout = '1500ms'");
        return this.evidence(m, selection, owned);
      }),
    );
  }
  async request(rawRequestId: string, actor: string) {
    this.actor(actor);
    const requestId = this.parse(priceRequestId, rawRequestId);
    return this.available(async () => {
      const [row] = await this.db.query(
        "SELECT draft_id,receipt FROM commerce_promotion_draft_requests WHERE actor_id=$1 AND request_id=$2 AND receipt->'scenario'->>'kind'='product_content_edit'",
        [actor, requestId],
      );
      if (!row)
        throw new NotFoundException(
          "Committed content edit not found for this account",
        );
      const receipt = verifyProductContentReceipt(row.receipt);
      if (
        receipt.updatedBy !== actor ||
        receipt.requestId !== requestId ||
        receipt.id !== row.draft_id
      )
        throw Error("Receipt identity differs from its persisted request");
      return receipt;
    });
  }
  async saveFromProductUpdate(
    rawProductId: string,
    rawBody: unknown,
    actor: string,
  ) {
    this.actor(actor);
    const productId = this.parse(priceRequestId, rawProductId),
      body = this.parse(productContentUpdateSchema, rawBody);
    const packet = this.parse(productContentPacketSchema, {
      productId,
      ...body.contentEdit,
      fields: this.fields(body.fields),
    });
    const requestHash = hash({ kind: "product_content_edit", packet });
    return this.available(() =>
      this.db.transaction(async (m) => {
        // Bound every lock wait in the new reviewed flow, including duplicate
        // request coordination and the native SKU lock. Legacy writers retain
        // their existing behavior.
        await m.query("SET LOCAL lock_timeout = '1500ms'");
        await m.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          `promotion-draft:${actor}:${packet.requestId}`,
        ]);
        const [previous] = await m.query(
          "SELECT request_hash,draft_id,receipt FROM commerce_promotion_draft_requests WHERE actor_id=$1 AND request_id=$2",
          [actor, packet.requestId],
        );
        if (previous) {
          if (previous.request_hash !== requestHash)
            throw new ConflictException(
              "Request ID already identifies a different action",
            );
          const receipt = verifyProductContentReceipt(previous.receipt, packet);
          if (receipt.updatedBy !== actor || receipt.id !== previous.draft_id)
            throw Error("Receipt identity differs from its persisted request");
          return { ...receipt, replayed: true };
        }
        if (!ownsProductContent())
          throw new ConflictException(
            "Josh still owns product content. No content edit can be saved here.",
          );
        await m.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          `product-content:${packet.sku}`,
        ]);
        // Catalog IDs are unique, SKUs are not. Existing-row locks cannot stop
        // another ID being inserted, reactivated or re-keyed into this SKU.
        // Acquire the shared table lock after the native SKU lock, then read the
        // mapping. Catalog sync only writes the catalog and does not take the
        // content lock, so this order keeps native writers serialized without
        // a catalog/content lock cycle. Release it with this short transaction.
        await m.query("LOCK TABLE josh_catalog_products IN SHARE MODE");
        const review = await this.evidence(m, packet, true, true);
        await this.content.editWithin(m, packet.sku, packet.fields, actor);
        const saved = await this.state(m, productId, true, true);
        if (
          saved.sku !== packet.sku ||
          saved.currentSource !== "staff" ||
          saved.currentUpdatedBy !== actor
        )
          throw Error(
            "Native saved provenance differs from requested content edit",
          );
        const id = randomUUID(),
          savedAt = new Date().toISOString();
        const receipt = verifyProductContentReceipt(
          {
            kind: "product_content_edit",
            scenario: { kind: "product_content_edit" },
            id,
            requestId: packet.requestId,
            packet,
            status: "committed",
            persisted: true,
            savedAt,
            before: review.item,
            after: saved.current,
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
            JSON.stringify({ kind: "product_content_edit", packet }),
            JSON.stringify(review),
            JSON.stringify(receipt),
          ],
        );
        await m.query(
          "INSERT INTO commerce_promotion_draft_requests(actor_id,request_id,request_hash,draft_id,receipt) VALUES($1,$2,$3,$4,$5)",
          [actor, packet.requestId, requestHash, id, JSON.stringify(receipt)],
        );
        return { ...receipt, replayed: false };
      }),
    );
  }
}
