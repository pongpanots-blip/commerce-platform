import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import {
  StaffRequest,
  StaffRoles,
} from "../../../shared-kernel/presentation/auth.decorators";
import { AssignmentWorkspaceService } from "./assignment-workspace.service";
/** Original assignment authority only. Review is read-only; save uses the native transactional outbox. */
@Controller("cs-admin/assignment-workspace")
@StaffRoles("sales_manager")
export class AssignmentWorkspaceController {
  constructor(private readonly workspace: AssignmentWorkspaceService) {}
  @Header("Cache-Control", "private, no-store") @Get("companies") search(
    @Query("search") search = "",
  ) {
    return this.workspace.search(search);
  }
  @Header("Cache-Control", "private, no-store") @Post("review") review(
    @Body() body: unknown,
  ) {
    return this.workspace.review(body);
  }
  @Header("Cache-Control", "private, no-store") @Get("requests/:id") request(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() req: StaffRequest,
  ) {
    return this.workspace.request(id, req.staff.userId);
  }
  @Header("Cache-Control", "private, no-store")
  @Post("actions")
  save(@Body() body: unknown, @Req() req: StaffRequest) {
    return this.workspace.save(body, req.staff.userId);
  }
}
