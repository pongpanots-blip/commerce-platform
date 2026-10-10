import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { z } from "zod";
import {
  StaffRequest,
  StaffRoles,
} from "../../../shared-kernel/presentation/auth.decorators";
import { CommercialSourcesService } from "./commercial-sources.service";
import { CommercialDraftsService } from "./commercial-drafts.service";
import { PlanKind, planScenarioSchema } from "./commercial-work";
/** Both controllers use the original global staff guard; Sales retains GET-only. */
class PlanningActions {
  constructor(
    protected readonly inputs: CommercialSourcesService,
    protected readonly drafts: CommercialDraftsService,
    protected readonly kind: PlanKind,
  ) {}
  protected async valid<T>(run: () => Promise<T>) {
    try {
      return await run();
    } catch (e) {
      if (e instanceof z.ZodError || e instanceof SyntaxError)
        throw new BadRequestException("Invalid planning proposal");
      throw e;
    }
  }
  subjectsFor(req: StaffRequest, raw: unknown) {
    return this.valid(() => {
      const q = z
        .object({ q: z.string().max(100).optional() })
        .strict()
        .parse(raw);
      return this.inputs.subjects(this.kind, q.q ?? "", req.staff);
    });
  }
  inputsFor(req: StaffRequest, id: string, raw: unknown) {
    return this.valid(() => {
      const q = z.object({ orderId: z.uuid().optional() }).strict().parse(raw);
      return this.inputs.inputs(
        this.kind,
        id,
        q.orderId?.toLowerCase() ?? null,
        req.staff,
      );
    });
  }
  previewFor(req: StaffRequest, raw: unknown) {
    return this.valid(async () => {
      const q = z
        .object({
          scenario: z
            .string()
            .min(1)
            .max(7000)
            .regex(/^[A-Za-z0-9_-]+$/),
        })
        .strict()
        .parse(raw);
      const s = planScenarioSchema.parse(
        JSON.parse(Buffer.from(q.scenario, "base64url").toString("utf8")),
      );
      if (s.kind !== this.kind)
        throw new BadRequestException("Planning kind mismatch");
      return this.inputs.preview(s, req.staff);
    });
  }
  listFor(req: StaffRequest, raw: unknown) {
    return this.valid(() => {
      const q = z.object({ after: z.uuid().optional() }).strict().parse(raw);
      return this.drafts.list(this.kind, req.staff, q.after);
    });
  }
}
@Controller("reports/sales-work")
@StaffRoles("sale", "sales_manager")
export class SalesWorkController extends PlanningActions {
  constructor(
    inputs: CommercialSourcesService,
    drafts: CommercialDraftsService,
  ) {
    super(inputs, drafts, "sales_work");
  }
  @Get("subjects") @Header("Cache-Control", "private, no-store") subjects(
    @Req() req: StaffRequest,
    @Query() q: unknown,
  ) {
    return this.subjectsFor(req, q);
  }
  @Get("inputs/:id")
  @Header("Cache-Control", "private, no-store")
  inputsForSubject(
    @Req() req: StaffRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Query() q: unknown,
  ) {
    return this.inputsFor(req, id, q);
  }
  @Get("preview") @Header("Cache-Control", "private, no-store") preview(
    @Req() req: StaffRequest,
    @Query() q: unknown,
  ) {
    return this.previewFor(req, q);
  }
  @Get("drafts") @Header("Cache-Control", "private, no-store") list(
    @Req() req: StaffRequest,
    @Query() q: unknown,
  ) {
    return this.listFor(req, q);
  }
  @Post("drafts") @HttpCode(200) @StaffRoles("sales_manager") create(
    @Req() req: StaffRequest,
    @Body() raw: unknown,
  ) {
    return this.valid(() => this.drafts.create(this.kind, raw, req.staff));
  }
  @Patch("drafts/:id") @StaffRoles("sales_manager") update(
    @Req() req: StaffRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() raw: unknown,
  ) {
    return this.valid(() => this.drafts.update(this.kind, id, raw, req.staff));
  }
  @Get("drafts/:id") @Header("Cache-Control", "private, no-store") get(
    @Req() req: StaffRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.drafts.get(this.kind, id, req.staff);
  }
  @Get("requests/:id") @Header("Cache-Control", "private, no-store") request(
    @Req() req: StaffRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.drafts.request(this.kind, id, req.staff);
  }
}
@Controller("reports/marketing-readiness")
@StaffRoles("marketing")
export class MarketingReadinessController extends PlanningActions {
  constructor(
    inputs: CommercialSourcesService,
    drafts: CommercialDraftsService,
  ) {
    super(inputs, drafts, "marketing_readiness");
  }
  @Get("subjects") @Header("Cache-Control", "private, no-store") subjects(
    @Req() req: StaffRequest,
    @Query() q: unknown,
  ) {
    return this.subjectsFor(req, q);
  }
  @Get("inputs/:id")
  @Header("Cache-Control", "private, no-store")
  inputsForSubject(
    @Req() req: StaffRequest,
    @Param("id") id: string,
    @Query() q: unknown,
  ) {
    return this.inputsFor(req, id, q);
  }
  @Get("preview") @Header("Cache-Control", "private, no-store") preview(
    @Req() req: StaffRequest,
    @Query() q: unknown,
  ) {
    return this.previewFor(req, q);
  }
  @Get("drafts") @Header("Cache-Control", "private, no-store") list(
    @Req() req: StaffRequest,
    @Query() q: unknown,
  ) {
    return this.listFor(req, q);
  }
  @Post("drafts") @HttpCode(200) create(
    @Req() req: StaffRequest,
    @Body() raw: unknown,
  ) {
    return this.valid(() => this.drafts.create(this.kind, raw, req.staff));
  }
  @Patch("drafts/:id") update(
    @Req() req: StaffRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() raw: unknown,
  ) {
    return this.valid(() => this.drafts.update(this.kind, id, raw, req.staff));
  }
  @Get("drafts/:id") @Header("Cache-Control", "private, no-store") get(
    @Req() req: StaffRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.drafts.get(this.kind, id, req.staff);
  }
  @Get("requests/:id") @Header("Cache-Control", "private, no-store") request(
    @Req() req: StaffRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.drafts.request(this.kind, id, req.staff);
  }
}
