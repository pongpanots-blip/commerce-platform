import {
  Body,
  Controller,
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

/** Same competitor readership; original global read-only staff rule blocks BA writes. */
@Controller("competitor-prices/workspace")
@StaffRoles("marketing", "business_analyst")
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
  @Post("actions") @StaffRoles("marketing") save(
    @Body() body: unknown,
    @Req() req: StaffRequest,
  ) {
    return this.workspace.save(body, req.staff.userId, req.staff.email);
  }
}
