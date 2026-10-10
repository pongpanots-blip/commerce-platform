import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { createHash, randomUUID } from "node:crypto";
import { DataSource, EntityManager } from "typeorm";
import {
  EVENT_BUS,
  IEventBus,
} from "../../../shared-kernel/interfaces/event-bus.interface";
import { JoshCustomers } from "../connector/josh/josh-customers";
import { staffRosterSql } from "../winback/shared/winback-staff-roster";
import { CompanySalesRepAssigned, ownsSalesReps } from "./sales-reps.service";
import {
  assignmentPacketSchema,
  assignmentReviewSchema,
  assignmentSelectionSchema,
  verifyAssignmentReceipt,
  AssignmentPacket,
  AssignmentReview,
} from "./assignment-contracts";
const roles = ["sale", "sales", "manager"];
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
type Row = { id: string; assigned_sales_user_id: string | null; stamp: string };
@Injectable()
export class AssignmentWorkspaceService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly companies: JoshCustomers,
    @Inject(EVENT_BUS) private readonly events: IEventBus,
  ) {}
  private async available<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (e) {
      if (e instanceof HttpException) throw e;
      throw new ServiceUnavailableException(
        "Assignment sources or receipt storage unavailable. Check the original request before retrying.",
      );
    }
  }
  private parse<T>(
    schema: { safeParse(v: unknown): { success: boolean; data?: T } },
    raw: unknown,
  ): T {
    const result = schema.safeParse(raw);
    if (!result.success)
      throw new BadRequestException(
        "Invalid assignment scope. Select 1–20 unique companies and an eligible owner.",
      );
    return result.data as T;
  }
  private authority() {
    if (!ownsSalesReps())
      throw new ConflictException(
        "Sales assignments are still owned by Josh. Commerce cannot save them.",
      );
  }
  async search(search: string) {
    if (typeof search !== "string")
      throw new BadRequestException("Search must be a string");
    return this.available(async () => {
      const result = await this.companies.planningSubjects(
        search.trim().slice(0, 100),
      );
      return {
        ...result,
        ownership: ownsSalesReps() ? "commerce" : "josh",
        sourceFreshness: "unverified",
      };
    });
  }
  private async roster(m: EntityManager) {
    return m.query(staffRosterSql(roles), [roles]) as Promise<
      { id: string; name: string }[]
    >;
  }
  /** Native assignment authority; imported customer counts are explicitly copies, never live coverage. */
  private async state(
    m: EntityManager,
    ids: string[],
    names: Map<string, string>,
  ) {
    const rows: Row[] = await m.query(
      "SELECT id,assigned_sales_user_id,updated_at::text AS stamp FROM company_sales_reps WHERE id=ANY($1::uuid[]) ORDER BY id",
      [ids],
    );
    const copies: { id: string; company_id: string; stamp: string }[] =
      await m.query(
        `SELECT id,data->>'company_id' AS company_id,md5(data::text) AS stamp FROM josh_customers WHERE data->>'company_id'=ANY($1::text[]) AND deleted_at IS NULL ORDER BY id`,
        [ids],
      );
    const reps = await this.roster(m);
    return ids.map((companyId) => {
      const row = rows.find((r) => r.id === companyId),
        customers = copies.filter((c) => c.company_id === companyId);
      if (!row && !customers.length)
        throw new NotFoundException(
          `Company ${companyId} is unavailable in the assignment import`,
        );
      const previousId = row?.assigned_sales_user_id ?? null;
      return {
        companyId,
        name: names.get(companyId) ?? companyId,
        recorded: !!row,
        previousOwner: previousId
          ? {
              id: previousId,
              name: reps.find((r) => r.id === previousId)?.name ?? previousId,
            }
          : null,
        version: hash({ row: row ?? null, customers }),
        importedCustomerCount: customers.length,
      };
    });
  }
  private async names(ids: string[]) {
    const rows = await Promise.all(
      ids.map((id) => this.companies.planningSubject(id)),
    );
    return new Map(rows.map((row) => [String(row.id), String(row.name)]));
  }
  private async reviewIn(
    m: EntityManager,
    ids: string[],
    salesUserId: string | null,
    names: Map<string, string>,
  ): Promise<AssignmentReview> {
    const roster = await this.roster(m),
      newOwner = salesUserId ? roster.find((r) => r.id === salesUserId) : null;
    if (salesUserId && !newOwner)
      throw new NotFoundException(
        "Selected owner is not an active eligible sales rep",
      );
    const items = await this.state(m, ids, names);
    return assignmentReviewSchema.parse({
      items,
      newOwner: newOwner ? { id: newOwner.id, name: newOwner.name } : null,
      ownership: "commerce",
      sourceFreshness: "unverified",
      capturedAt: new Date().toISOString(),
    });
  }
  async review(raw: unknown) {
    const input = this.parse(assignmentSelectionSchema, raw);
    this.authority();
    return this.available(async () =>
      this.reviewIn(
        this.db.manager,
        input.companyIds,
        input.salesUserId,
        await this.names(input.companyIds),
      ),
    );
  }
  private actor(actor: string) {
    if (!actor || actor.length > 128)
      throw new BadRequestException("Invalid staff identity");
  }
  async request(id: string, actor: string) {
    this.actor(actor);
    return this.available(async () => {
      const [row] = await this.db.query(
        "SELECT receipt FROM commerce_promotion_draft_requests WHERE actor_id=$1 AND request_id=$2 AND receipt->'scenario'->>'kind'='customer_assignment'",
        [actor, id],
      );
      if (!row)
        throw new NotFoundException("Committed assignment request not found");
      return verifyAssignmentReceipt(row.receipt);
    });
  }
  async save(raw: unknown, actor: string) {
    const packet: AssignmentPacket = this.parse(assignmentPacketSchema, raw);
    this.actor(actor);
    return this.available(async () => {
      // A committed original request is recoverable even if ownership/sources subsequently change.
      try {
        const r = await this.request(packet.requestId, actor);
        verifyAssignmentReceipt(r, packet);
        return { ...r, replayed: true };
      } catch (e) {
        if (!(e instanceof NotFoundException)) {
          if (e instanceof HttpException) throw e;
          throw new ConflictException(
            "Request ID already identifies different assignments",
          );
        }
      }
      this.authority();
      const names = await this.names(packet.changes.map((c) => c.companyId));
      return this.db.transaction(async (m) => {
        await m.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          `promotion-draft:${actor}:${packet.requestId}`,
        ]);
        const [previous] = await m.query(
          "SELECT request_hash,receipt FROM commerce_promotion_draft_requests WHERE actor_id=$1 AND request_id=$2",
          [actor, packet.requestId],
        );
        const requestHash = hash(packet);
        if (previous) {
          if (previous.request_hash !== requestHash)
            throw new ConflictException(
              "Request ID already identifies different assignments",
            );
          return {
            ...verifyAssignmentReceipt(previous.receipt, packet),
            replayed: true,
          };
        }
        this.authority();
        const ids = packet.changes.map((c) => c.companyId);
        // Same locks used by the original single-company writer, sorted to avoid batch deadlocks.
        for (const id of [...ids].sort())
          await m.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
            `company-sales-rep:${id}`,
          ]);
        await m.query(
          "SELECT id FROM company_sales_reps WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
          [ids],
        );
        await m.query(
          `SELECT id FROM josh_customers WHERE data->>'company_id'=ANY($1::text[]) AND deleted_at IS NULL ORDER BY id FOR SHARE`,
          [ids],
        );
        // Protect active commerce reps / unlinked Josh reps against eligibility changes during commit.
        if (packet.salesUserId) {
          await m.query("SELECT id FROM users WHERE id=$1 FOR SHARE", [
            packet.salesUserId,
          ]);
          await m.query("SELECT id FROM josh_staff WHERE id=$1 FOR SHARE", [
            packet.salesUserId,
          ]);
        }
        const review = await this.reviewIn(m, ids, packet.salesUserId, names);
        const unchanged = review.items.filter(
          (i) =>
            i.recorded && (i.previousOwner?.id ?? null) === packet.salesUserId,
        );
        if (unchanged.length)
          throw new ConflictException(
            `Remove companies whose recorded owner is already the selected owner: ${unchanged.map((i) => i.name).join(", ")}`,
          );
        if (
          review.items.some((i, n) => i.version !== packet.changes[n].version)
        )
          throw new ConflictException(
            "Assignment or customer scope changed. Reload and review every company again.",
          );
        const changed = [];
        for (const item of review.items) {
          const [row]: Row[] = await m.query(
            `INSERT INTO company_sales_reps(id,assigned_sales_user_id,updated_at) VALUES($1,$2,clock_timestamp())
            ON CONFLICT(id) DO UPDATE SET assigned_sales_user_id=EXCLUDED.assigned_sales_user_id,updated_at=GREATEST(clock_timestamp(),company_sales_reps.updated_at+interval '1 millisecond')
            RETURNING id,assigned_sales_user_id,updated_at::text AS stamp`,
            [item.companyId, packet.salesUserId],
          );
          await this.events.publish(
            new CompanySalesRepAssigned({
              companyId: item.companyId,
              salesUserId: packet.salesUserId,
              assignedAt: new Date(row.stamp).toISOString(),
            }),
            m,
          );
          changed.push(item.companyId);
        }
        const after = await this.state(m, ids, names),
          savedAt = new Date().toISOString(),
          id = randomUUID();
        const receipt = verifyAssignmentReceipt(
          {
            kind: "customer_assignment",
            scenario: { kind: "customer_assignment" },
            id,
            requestId: packet.requestId,
            packet,
            status: "committed",
            persisted: true,
            appliedCount: changed.length,
            items: review.items.map((i, n) => ({
              ...i,
              newOwner: review.newOwner,
              savedVersion: after[n].version,
            })),
            savedAt,
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
            JSON.stringify({ kind: "customer_assignment", packet }),
            JSON.stringify(review),
            JSON.stringify(receipt),
          ],
        );
        await m.query(
          "INSERT INTO commerce_promotion_draft_requests(actor_id,request_id,request_hash,draft_id,receipt) VALUES($1,$2,$3,$4,$5)",
          [actor, packet.requestId, requestHash, id, JSON.stringify(receipt)],
        );
        return { ...receipt, replayed: false };
      });
    });
  }
}
