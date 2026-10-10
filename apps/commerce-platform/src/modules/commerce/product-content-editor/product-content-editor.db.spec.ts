import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { DataSource, EntityManager } from "typeorm";
import { EventEmitterBus } from "../../../shared-kernel/infrastructure/event-emitter.bus";
import { OutboxMessage } from "../../../shared-kernel/infrastructure/outbox.entity";
import { ProductContentsService } from "../product-contents/product-contents.service";
import { skuAggregateId } from "../product-prices/product-price-snapshot.event";
import { ProductContentEditorService } from "./product-content-editor.service";
import {
  productContentUpdateEnvelope,
  type ProductContentSelection,
} from "./product-content-editor-contracts";

const url = process.env.PRICE_APPROVAL_TEST_DATABASE_URL;
(url ? describe : describe.skip)("bounded content edits in owned SQL", () => {
  let db: DataSource,
    schema: string,
    protectedBefore: string,
    native: ProductContentsService,
    editor: ProductContentEditorService;
  const productId = "00000000-0000-4000-8000-0000000000ab",
    sku = " exact ไทย SKU ";
  const oldOwnership = process.env.COMMERCE_OWNS_PRODUCT_CONTENT;
  const protectedState = async () =>
    JSON.stringify(
      await Promise.all(
        [
          "commerce_promotion_drafts",
          "commerce_promotion_draft_requests",
          "josh_catalog_products",
          "product_promotion_rules",
        ].map((table) =>
          db.query(
            "SELECT * FROM public." +
              table +
              " ORDER BY " +
              (table === "commerce_promotion_draft_requests"
                ? "actor_id,request_id"
                : table === "product_promotion_rules"
                  ? "sku"
                  : "id"),
          ),
        ),
      ),
    );
  const state = async () =>
    JSON.stringify(
      await Promise.all(
        [
          "product_contents",
          "josh_catalog_products",
          "outbox_messages",
          "commerce_promotion_drafts",
          "commerce_promotion_draft_requests",
        ].map((table) =>
          db.query(
            "SELECT * FROM " +
              table +
              " ORDER BY " +
              (table === "product_contents"
                ? "product_inventory_sku"
                : table === "commerce_promotion_draft_requests"
                  ? "actor_id,request_id"
                  : "id"),
          ),
        ),
      ),
    );
  const packet = async (
    fields: ProductContentSelection["fields"] = {
      product_name_th: "ใหม่",
      allergens: null,
    },
  ) => {
    const item = (await editor.itemFor(productId)).item;
    return {
      productId,
      sku: item.sku,
      version: item.version,
      fields,
      requestId: randomUUID(),
    };
  };
  const save = async (
    p: Awaited<ReturnType<typeof packet>>,
    actor = "content-actor",
  ) =>
    editor.saveFromProductUpdate(
      p.productId,
      productContentUpdateEnvelope(p),
      actor,
    );
  const eventCount = async () =>
    Number((await db.query("SELECT count(*) AS n FROM outbox_messages"))[0].n);
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (
      parsed.hostname !== "127.0.0.1" ||
      parsed.port !== process.env.PRICE_APPROVAL_FIXTURE_PORT ||
      parsed.pathname !== "/commerce_preview_test" ||
      process.env.PRICE_APPROVAL_FIXTURE_OWNED !==
        "commerce-pack-price-20261009"
    )
      throw Error("Explicit owned local fixture required");
    schema = "content_editor_fixture_" + randomUUID().replace(/-/g, "");
    db = await new DataSource({
      type: "postgres",
      url,
      schema,
      entities: [OutboxMessage],
      uuidExtension: "pgcrypto",
      installExtensions: false,
      synchronize: false,
      extra: { max: 6, options: "-c search_path=" + schema },
    }).initialize();
    protectedBefore = await protectedState();
    await db.query(`CREATE SCHEMA "${schema}"`);
    for (const table of [
      "commerce_promotion_drafts",
      "commerce_promotion_draft_requests",
    ])
      await db.query(
        `CREATE TABLE "${schema}".${table}(LIKE public.${table} INCLUDING ALL)`,
      );
    await db.query(
      "ALTER TABLE commerce_promotion_draft_requests ADD CONSTRAINT content_fixture_receipt_fk FOREIGN KEY(draft_id) REFERENCES commerce_promotion_drafts(id)",
    );
    await db.query(
      "CREATE TABLE product_contents(product_inventory_sku varchar(64) PRIMARY KEY, fields jsonb NOT NULL, source varchar(16) NOT NULL DEFAULT 'import', updated_by text, updated_at timestamptz NOT NULL DEFAULT now())",
    );
    await db.query(
      "CREATE TABLE josh_catalog_products(id uuid PRIMARY KEY,sku varchar(100) NOT NULL,translations jsonb NOT NULL DEFAULT '[]',removed_at timestamptz,synced_at timestamptz NOT NULL DEFAULT now())",
    );
    for (const query of (await db.driver.createSchemaBuilder().log())
      .upQueries) {
      if (
        !query.query.includes(`"${schema}"`) ||
        /DROP TABLE|DROP SCHEMA|TRUNCATE/i.test(query.query)
      )
        throw Error("Fixture DDL outside owned schema");
      await db.query(query.query, query.parameters);
    }
    native = new ProductContentsService(
      db,
      new EventEmitterBus(db.getRepository(OutboxMessage)),
    );
    editor = new ProductContentEditorService(db, native);
  });
  beforeEach(async () => {
    process.env.COMMERCE_OWNS_PRODUCT_CONTENT = "true";
    for (const table of [
      "commerce_promotion_draft_requests",
      "commerce_promotion_drafts",
      "outbox_messages",
      "product_contents",
      "josh_catalog_products",
    ])
      await db.query("DELETE FROM " + table);
    await db.query(
      "INSERT INTO josh_catalog_products(id,sku,translations) VALUES($1,$2,$3)",
      [
        productId,
        sku,
        JSON.stringify([
          {
            language_code: "th",
            product_name: "Copied",
            product_description: "Copied description",
          },
        ]),
      ],
    );
    await db.query(
      "INSERT INTO product_contents(product_inventory_sku,fields) VALUES($1,$2)",
      [
        sku,
        JSON.stringify({
          product_name_en: "Original",
          product_description_en: null,
          ingredients: "flour",
          buying_price: 12.5,
          low_stock_threshold: 3,
        }),
      ],
    );
  });
  afterAll(async () => {
    if (oldOwnership === undefined)
      delete process.env.COMMERCE_OWNS_PRODUCT_CONTENT;
    else process.env.COMMERCE_OWNS_PRODUCT_CONTENT = oldOwnership;
    if (!db?.isInitialized) return;
    try {
      expect(await protectedState()).toBe(protectedBefore);
    } finally {
      try {
        await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      } finally {
        await db.destroy();
      }
    }
  });

  it("reviews without writes, keeps absent/null distinct, saves only six fields and publishes the actual complete native snapshot", async () => {
    const p = await packet(),
      before = await state();
    const review = await editor.review({
      productId: p.productId,
      sku: p.sku,
      version: p.version,
      fields: p.fields,
    });
    expect(review.item.current).toEqual({
      product_name_en: "Original",
      product_description_en: null,
      ingredients: "flour",
    });
    expect(
      Object.prototype.hasOwnProperty.call(
        review.item.current,
        "product_name_th",
      ),
    ).toBe(false);
    expect(await state()).toBe(before);
    const receipt = await save(p);
    expect(receipt).toMatchObject({
      persisted: true,
      source: "staff",
      updatedBy: "content-actor",
      outboxEnqueued: true,
      downstreamDelivery: "unverified",
      after: {
        product_name_th: "ใหม่",
        product_name_en: "Original",
        product_description_en: null,
        ingredients: "flour",
        allergens: null,
      },
    });
    const [record] = await db.query(
      "SELECT fields,source,updated_by FROM product_contents WHERE product_inventory_sku=$1",
      [sku],
    );
    expect(record).toMatchObject({
      fields: { ...receipt.after, buying_price: 12.5, low_stock_threshold: 3 },
      source: "staff",
      updated_by: "content-actor",
    });
    const [event] = await db.query(
      "SELECT payload,status FROM outbox_messages WHERE type='product.content.snapshot' AND aggregate_id=$1",
      [skuAggregateId(sku, "content")],
    );
    expect(event).toMatchObject({
      status: "pending",
      payload: { sku, fields: record.fields },
    });
    expect(Number.isNaN(Date.parse(event.payload.version))).toBe(false);
    expect(await eventCount()).toBe(1);
    expect(
      await editor.request(p.requestId.toUpperCase(), "content-actor"),
    ).toMatchObject({ packet: p, id: receipt.id });
    await expect(editor.request(p.requestId, "other-account")).rejects.toThrow(
      "not found",
    );
  });
  it("normalizes exactly native rules and treats an explicit same-value write as a real staff action", async () => {
    const p = await packet({
      product_name_en: "  Original  ",
      ingredients: "  ",
    });
    const receipt = await save(p);
    expect(receipt.packet.fields).toEqual({
      product_name_en: "Original",
      ingredients: null,
    });
    expect(receipt.after).toMatchObject({
      product_name_en: "Original",
      ingredients: null,
    });
    expect(await eventCount()).toBe(1);
    const second = await save(
      await packet({ product_name_en: "Original" }),
      "same-value",
    );
    expect(second.after).toEqual(second.before.current);
    expect(await eventCount()).toBe(2);
  });
  it("owned missing native rows never borrow copied names and can create only the requested fields", async () => {
    await db.query("DELETE FROM product_contents");
    const item = (await editor.itemFor(productId)).item;
    expect(item).toMatchObject({
      current: {},
      currentRecorded: false,
      evidenceSource: "unavailable",
    });
    const receipt = await save(await packet({ ingredients: null }));
    expect(receipt.after).toEqual({ ingredients: null });
    expect((await editor.itemFor(productId)).item.current).toEqual({
      ingredients: null,
    });
  });
  it("labels archived/native or copied evidence when ownership is disabled and blocks new writes", async () => {
    process.env.COMMERCE_OWNS_PRODUCT_CONTENT = "false";
    expect(await editor.itemFor(productId)).toMatchObject({
      ownership: "josh",
      item: {
        evidenceSource: "archived_native",
        current: { product_name_en: "Original" },
      },
    });
    const p = await packet(),
      before = await state();
    await expect(save(p)).rejects.toThrow("owns");
    expect(await state()).toBe(before);
    await db.query("DELETE FROM product_contents");
    expect(await editor.itemFor(productId)).toMatchObject({
      ownership: "josh",
      item: {
        evidenceSource: "copied_snapshot",
        currentRecorded: false,
        current: {
          product_name_th: "Copied",
          product_description_th: "Copied description",
        },
      },
    });
    await expect(save(await packet())).rejects.toThrow("owns");
  });
  it.each(["native", "same-value", "commercial-field", "mapping", "catalog"])(
    "rejects stale full revision after %s change with no partial action",
    async (kind) => {
      const p = await packet();
      if (kind === "native")
        await native.edit(sku, { ingredients: "changed" }, "legacy");
      if (kind === "same-value")
        await native.edit(sku, { product_name_en: "Original" }, "legacy");
      if (kind === "commercial-field")
        await native.edit(sku, { buying_price: 13 }, "legacy");
      if (kind === "mapping")
        await db.query(
          "UPDATE josh_catalog_products SET sku='OTHER-SKU' WHERE id=$1",
          [productId],
        );
      if (kind === "catalog")
        await db.query(
          "UPDATE josh_catalog_products SET synced_at=clock_timestamp() WHERE id=$1",
          [productId],
        );
      const before = await state();
      await expect(save(p)).rejects.toThrow("changed");
      expect(await state()).toBe(before);
    },
  );
  it("binds exact route product ID and rejects unknown, removed, wrong-SKU and duplicate mappings", async () => {
    const p = await packet(),
      before = await state();
    await expect(editor.itemFor(randomUUID())).rejects.toThrow("not found");
    await expect(
      editor.saveFromProductUpdate(
        randomUUID(),
        productContentUpdateEnvelope(p),
        "actor",
      ),
    ).rejects.toThrow("not found");
    await expect(
      editor.saveFromProductUpdate(
        productId,
        {
          ...productContentUpdateEnvelope(p),
          contentEdit: {
            ...productContentUpdateEnvelope(p).contentEdit,
            sku: "OTHER",
          },
        },
        "actor",
      ),
    ).rejects.toThrow("changed");
    expect(await state()).toBe(before);
    await db.query("INSERT INTO josh_catalog_products(id,sku) VALUES($1,$2)", [
      randomUUID(),
      sku,
    ]);
    await expect(editor.itemFor(productId)).rejects.toThrow("more than one");
    await expect(save(p)).rejects.toThrow("more than one");
    await db.query("DELETE FROM josh_catalog_products WHERE id<>$1", [
      productId,
    ]);
    await db.query(
      "UPDATE josh_catalog_products SET removed_at=now() WHERE id=$1",
      [productId],
    );
    await expect(save(p)).rejects.toThrow("not found");
    expect(await eventCount()).toBe(0);
  });
  it("concurrent duplicate clicks create one immutable native event and receipt, and replay works after later changes/ownership cutoff", async () => {
    const p = await packet(),
      [a, b] = await Promise.all([save(p, "duplicate"), save(p, "duplicate")]);
    expect(a.id).toBe(b.id);
    expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
    expect(await eventCount()).toBe(1);
    await native.edit(sku, { ingredients: "later" }, "later");
    process.env.COMMERCE_OWNS_PRODUCT_CONTENT = "false";
    expect(await save(p, "duplicate")).toMatchObject({
      id: a.id,
      after: a.after,
      replayed: true,
    });
    expect(await editor.request(p.requestId, "duplicate")).toMatchObject({
      id: a.id,
    });
    await expect(
      save({ ...p, fields: { allergens: "different" } }, "duplicate"),
    ).rejects.toThrow("different action");
    expect(await eventCount()).toBe(2);
  });
  it("distinct reviewed actions serialize and exactly one version can commit", async () => {
    const a = await packet(),
      b = { ...a, requestId: randomUUID(), fields: { ingredients: "second" } };
    const results = await Promise.allSettled([
      save(a, "first"),
      save(b, "second"),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(await eventCount()).toBe(1);
    expect(
      Number(
        (
          await db.query(
            "SELECT count(*) n FROM commerce_promotion_draft_requests",
          )
        )[0].n,
      ),
    ).toBe(1);
  });
  it("a legacy native content writer shares the lock and its committed change invalidates the review", async () => {
    const p = await packet(),
      runner = db.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      await native.editWithin(
        runner.manager,
        sku,
        { ingredients: "legacy-first" },
        "legacy",
      );
      const saving = save(p, "reviewed-second");
      await runner.commitTransaction();
      await expect(saving).rejects.toThrow("changed");
      expect((await native.get(sku)).fields.ingredients).toBe("legacy-first");
      expect(await eventCount()).toBe(1);
    } finally {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await runner.release();
    }
  });
  it("holds the catalog mapping against concurrent changes until native edit and receipt commit", async () => {
    const original = native.editWithin.bind(native);
    const spy = jest
      .spyOn(native, "editWithin")
      .mockImplementationOnce(async (...args) => {
        const runner = db.createQueryRunner();
        await runner.connect();
        await runner.startTransaction();
        try {
          await runner.query("SET LOCAL lock_timeout = '100ms'");
          await expect(
            runner.query(
              "UPDATE josh_catalog_products SET sku='RACE' WHERE id=$1",
              [productId],
            ),
          ).rejects.toThrow(/lock timeout/);
        } finally {
          await runner.rollbackTransaction();
          await runner.release();
        }
        return original(...args);
      });
    try {
      expect((await save(await packet())).persisted).toBe(true);
    } finally {
      spy.mockRestore();
    }
    expect((await editor.itemFor(productId)).item.sku).toBe(sku);
  });
  const catalogMutation = async (kind: string) => {
    const otherId = randomUUID();
    if (kind === "reactivate")
      await db.query(
        "INSERT INTO josh_catalog_products(id,sku,removed_at) VALUES($1,$2,now())",
        [otherId, sku],
      );
    if (kind === "rekey")
      await db.query(
        "INSERT INTO josh_catalog_products(id,sku) VALUES($1,'DIFFERENT-SKU')",
        [otherId],
      );
    return {
      sql:
        kind === "insert"
          ? "INSERT INTO josh_catalog_products(id,sku) VALUES($1,$2)"
          : kind === "reactivate"
            ? "UPDATE josh_catalog_products SET removed_at=NULL WHERE id=$1 AND sku=$2"
            : "UPDATE josh_catalog_products SET sku=$2 WHERE id=$1",
      parameters: [otherId, sku],
    };
  };
  const expectCatalogWriterWaiting = async (pid: number) => {
    for (let attempt = 0; attempt < 50; attempt++) {
      const [lock] = await db.query(
        "SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=$1 AND relation='josh_catalog_products'::regclass AND mode='RowExclusiveLock' AND NOT granted) AS waiting",
        [pid],
      );
      if (lock.waiting) return;
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
    }
    throw Error("Catalog mutation did not wait on the editor's table lock");
  };
  it.each(["insert", "reactivate", "rekey"])(
    "withholds a concurrent %s joining the SKU after final evidence until the action commits",
    async (kind) => {
      const mutation = await catalogMutation(kind),
        p = await packet(),
        runner = db.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      const [{ pid }] = await runner.query("SELECT pg_backend_pid() AS pid");
      let writer: Promise<void> | undefined,
        writerCompleted = false;
      const coordinated = new ProductContentEditorService(
        {
          transaction: async (run: (m: EntityManager) => Promise<unknown>) =>
            db.transaction(async (m) => {
              const original = m.query.bind(m),
                query = jest
                  .spyOn(m, "query")
                  .mockImplementation(
                    async (sql: string, parameters?: any[]) => {
                      // This insert follows the final mapping/native evidence check.
                      // Start a different-ID catalog mutation at that exact boundary.
                      if (
                        sql.startsWith("INSERT INTO commerce_promotion_drafts")
                      ) {
                        writer = (async () => {
                          await runner.query(mutation.sql, mutation.parameters);
                          await runner.commitTransaction();
                          writerCompleted = true;
                        })();
                        // Attach a handler now while the mutation deliberately waits.
                        writer.catch(() => undefined);
                        await expectCatalogWriterWaiting(Number(pid));
                        expect(writerCompleted).toBe(false);
                      }
                      return original(sql, parameters);
                    },
                  );
              try {
                return await run(m);
              } finally {
                query.mockRestore();
              }
            }),
        } as unknown as DataSource,
        native,
      );
      try {
        const receipt = await coordinated.saveFromProductUpdate(
          productId,
          productContentUpdateEnvelope(p),
          "mapping-boundary",
        );
        expect(receipt.persisted).toBe(true);
        expect(writer).toBeDefined();
        await writer;
        expect(writerCompleted).toBe(true);
        expect(
          await editor.request(p.requestId, "mapping-boundary"),
        ).toMatchObject({ id: receipt.id, packet: p });
        expect(await eventCount()).toBe(1);
        await expect(editor.itemFor(productId)).rejects.toThrow(
          "more than one",
        );
      } finally {
        if (runner.isTransactionActive) await runner.rollbackTransaction();
        if (writer) await writer.catch(() => undefined);
        await runner.release();
      }
    },
  );
  it.each(["insert", "reactivate", "rekey"])(
    "rejects a %s committed before the mapping table lock with no price/content/event/action writes",
    async (kind) => {
      const mutation = await catalogMutation(kind),
        p = await packet();
      await db.query(mutation.sql, mutation.parameters);
      const before = await state();
      await expect(save(p)).rejects.toThrow("more than one");
      expect(await state()).toBe(before);
      expect(await eventCount()).toBe(0);
    },
  );
  it.each(["request", "sku", "catalog"])(
    "bounds a contended %s lock, saves nothing, and safely retries the original request after the writer releases it",
    async (kind) => {
      const p = await packet(),
        before = await state(),
        runner = db.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      try {
        if (kind === "catalog")
          await runner.query(
            "LOCK TABLE josh_catalog_products IN ROW EXCLUSIVE MODE",
          );
        else
          await runner.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
            kind === "request"
              ? `promotion-draft:lock-timeout:${p.requestId}`
              : `product-content:${p.sku}`,
          ]);
        await expect(save(p, "lock-timeout")).rejects.toThrow("unavailable");
        expect(await state()).toBe(before);
        await expect(
          editor.request(p.requestId, "lock-timeout"),
        ).rejects.toThrow("not found");
        await runner.rollbackTransaction();
        expect((await save(p, "lock-timeout")).persisted).toBe(true);
        expect(await eventCount()).toBe(1);
      } finally {
        if (runner.isTransactionActive) await runner.rollbackTransaction();
        await runner.release();
      }
    },
  );
  it("recovers a lost acknowledgement after actual commit without a duplicate native event", async () => {
    const p = await packet(),
      disconnected = new ProductContentEditorService(
        {
          transaction: async (run: (m: EntityManager) => Promise<unknown>) => {
            await db.transaction(run);
            throw Error("Synthetic response lost after commit");
          },
        } as unknown as DataSource,
        native,
      );
    await expect(
      disconnected.saveFromProductUpdate(
        productId,
        productContentUpdateEnvelope(p),
        "interrupted",
      ),
    ).rejects.toThrow("unavailable");
    const receipt = await editor.request(p.requestId, "interrupted");
    expect(await save(p, "interrupted")).toMatchObject({
      id: receipt.id,
      replayed: true,
    });
    expect(await eventCount()).toBe(1);
  });
  it.each(["receipt", "outbox"])(
    "failed %s persistence rolls back native fields and every action record",
    async (kind) => {
      const p = await packet(),
        before = await state(),
        target =
          kind === "receipt"
            ? "commerce_promotion_draft_requests"
            : "outbox_messages";
      await db.query(
        "CREATE FUNCTION refuse_content_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'owned fixture fault'; END $$",
      );
      await db.query(
        `CREATE TRIGGER refuse_content_fixture BEFORE INSERT ON ${target} FOR EACH ROW EXECUTE FUNCTION refuse_content_fixture()`,
      );
      try {
        await expect(save(p, "rollback")).rejects.toThrow("unavailable");
        expect(await state()).toBe(before);
        await expect(editor.request(p.requestId, "rollback")).rejects.toThrow(
          "not found",
        );
      } finally {
        await db.query(`DROP TRIGGER refuse_content_fixture ON ${target}`);
        await db.query("DROP FUNCTION refuse_content_fixture()");
      }
    },
  );
  it.each(["actor", "request", "draft"])(
    "does not confirm corrupted persisted %s identity",
    async (kind) => {
      const p = await packet(),
        receipt = await save(p, "integrity"),
        corrupt = structuredClone(receipt);
      if (kind === "actor") corrupt.updatedBy = "other";
      if (kind === "request") {
        corrupt.requestId = randomUUID();
        corrupt.packet.requestId = corrupt.requestId;
      }
      if (kind === "draft") corrupt.id = randomUUID();
      await db.query(
        "UPDATE commerce_promotion_draft_requests SET receipt=$3 WHERE actor_id=$1 AND request_id=$2",
        ["integrity", p.requestId, JSON.stringify(corrupt)],
      );
      const before = await state();
      await expect(editor.request(p.requestId, "integrity")).rejects.toThrow(
        "unavailable",
      );
      await expect(save(p, "integrity")).rejects.toThrow("unavailable");
      expect(await state()).toBe(before);
    },
  );
  it("fails closed on mismatched native persistence and leaves commercial content untouched", async () => {
    const p = await packet(),
      before = await state();
    await db.query(
      'CREATE FUNCTION corrupt_content_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.fields := NEW.fields || \'{"product_name_th":"Wrong"}\'::jsonb; RETURN NEW; END $$',
    );
    await db.query(
      "CREATE TRIGGER corrupt_content_fixture BEFORE UPDATE ON product_contents FOR EACH ROW EXECUTE FUNCTION corrupt_content_fixture()",
    );
    try {
      await expect(save(p)).rejects.toThrow("unavailable");
      expect(await state()).toBe(before);
    } finally {
      await db.query(
        "DROP TRIGGER corrupt_content_fixture ON product_contents",
      );
      await db.query("DROP FUNCTION corrupt_content_fixture()");
    }
  });
  it("does not reuse another feature's request ID or reveal its private receipt", async () => {
    const p = await packet(),
      draftId = randomUUID();
    await db.query(
      "INSERT INTO commerce_promotion_drafts(id,actor_id,revision,scenario,evidence,preview) VALUES($1,'cross',1,'{}','{}','{}')",
      [draftId],
    );
    await db.query(
      "INSERT INTO commerce_promotion_draft_requests(actor_id,request_id,request_hash,draft_id,receipt) VALUES('cross',$1,$2,$3,$4)",
      [
        p.requestId,
        "a".repeat(64),
        draftId,
        JSON.stringify({ scenario: { kind: "product_price_edit" } }),
      ],
    );
    const before = await state();
    await expect(save(p, "cross")).rejects.toThrow("different action");
    await expect(editor.request(p.requestId, "cross")).rejects.toThrow(
      "not found",
    );
    expect(await state()).toBe(before);
  });
  it("rejects unsupported fields, malformed envelope and invalid actor before SQL", async () => {
    const p = await packet(),
      envelope = productContentUpdateEnvelope(p),
      tx = jest.spyOn(db, "transaction"),
      read = jest.spyOn(db, "query");
    try {
      for (const body of [
        { ...envelope, actor: "admin" },
        { ...envelope, productId },
        { ...envelope, fields: { buying_price: 1 } },
        { ...envelope, fields: { product_status: "active" } },
        { ...envelope, fields: {} },
        { ...envelope, fields: { product_name_en: null } },
        { ...envelope, fields: { ingredients: "x\u0000y" } },
        {
          ...envelope,
          contentEdit: { ...envelope.contentEdit, actor: "admin" },
        },
      ])
        await expect(
          editor.saveFromProductUpdate(productId, body, "actor"),
        ).rejects.toThrow("Invalid content edit");
      for (const actor of ["", " ", "a\u0000b", "x".repeat(129)]) {
        await expect(
          editor.saveFromProductUpdate(productId, envelope, actor),
        ).rejects.toThrow("identity");
        await expect(editor.request(p.requestId, actor)).rejects.toThrow(
          "identity",
        );
      }
      await expect(editor.itemFor("bad-id")).rejects.toThrow(
        "Invalid content edit",
      );
      expect(tx).not.toHaveBeenCalled();
      expect(read).not.toHaveBeenCalled();
    } finally {
      tx.mockRestore();
      read.mockRestore();
    }
  });
  it("preserves legacy validation, source=create and complete snapshot behavior without an envelope", async () => {
    const otherSku = "UNMAPPED-NEW-CONTENT";
    await expect(
      native.edit(otherSku, { ingredients: "x" }, "legacy"),
    ).rejects.toThrow("ไม่พบสินค้า");
    expect(
      await native.edit(
        otherSku,
        { product_name_en: " New ", buying_price: "7.50" },
        "create-actor",
        "create",
      ),
    ).toMatchObject({
      sku: otherSku,
      fields: { product_name_en: "New", buying_price: 7.5 },
    });
    await expect(
      native.edit(sku, { selling_unit: "kg" }, "legacy"),
    ).rejects.toThrow("ไม่ใช่เนื้อหาสินค้า");
    await expect(
      native.edit(sku, { product_name_th: "" }, "legacy"),
    ).rejects.toThrow("ชื่อสินค้าห้ามว่าง");
    expect((await native.get(otherSku)).source).toBe("create");
    expect(await eventCount()).toBe(1);
  });
});
