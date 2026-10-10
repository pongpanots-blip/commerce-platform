import {
  Body,
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from "@nestjs/common";
import {
  StaffRequest,
  StaffRoles,
} from "../../../shared-kernel/presentation/auth.decorators";
import { ComparisonWorkspaceService } from "./comparison-workspace.service";
import {
  canApplyComparisonPacket,
  comparisonPacketSchema,
} from "./comparison-contracts";

/** MER has comparison evidence access; the original global rule keeps BA read-only. */
@Controller("competitor-prices/workspace")
@StaffRoles("marketing", "business_analyst", "merchandising")
export class ComparisonWorkspaceController {
  constructor(private readonly workspace: ComparisonWorkspaceService) {}
  @Header("Cache-Control", "private, no-store") @Get("sources") sources() {
    return this.workspace.sources();
  }
  @Header("Cache-Control", "private, no-store") @Get("products/:sku") product(
    @Param("sku") sku: string,
  ) {
    return this.workspace.workspace(sku);
  }
  @Header("Cache-Control", "private, no-store")
  @Get("products/:sku/candidates")
  candidates(@Param("sku") sku: string) {
    return this.workspace.candidates(sku);
  }
  @Header("Cache-Control", "private, no-store") @Get("items/:id") item(
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.workspace.item(id);
  }
  @Header("Cache-Control", "private, no-store") @Get("handoff/:sku") handoff(
    @Param("sku") sku: string,
  ) {
    return this.workspace.handoff(sku);
  }
  @Header("Cache-Control", "private, no-store")
  @Get("pairs/:id/history")
  history(@Param("id", ParseUUIDPipe) id: string) {
    return this.workspace.history(id);
  }
  @Header("Cache-Control", "private, no-store") @Get("requests/:id") request(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() req: StaffRequest,
  ) {
    return this.workspace.request(id, req.staff.userId);
  }
  @Post("actions") @StaffRoles("marketing", "merchandising") save(
    @Body() body: unknown,
    @Req() req: StaffRequest,
  ) {
    const parsed = comparisonPacketSchema.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException("Invalid comparison action request");
    // Check the complete immutable packet before any source reads, vendor calls or writes.
    if (!canApplyComparisonPacket(req.staff.role, parsed.data))
      throw new ForbiddenException(
        "This account may only record reference prices and verify product matches",
      );
    return this.workspace.save(parsed.data, req.staff.userId, req.staff.email);
  }
}
