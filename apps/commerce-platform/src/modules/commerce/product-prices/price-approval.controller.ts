import { Body, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import {
  StaffRequest,
  StaffRoles,
} from "../../../shared-kernel/presentation/auth.decorators";
import { QueuePageQuery, queuePage } from "../queue-page";
import { PriceApprovalService } from "./price-approval.service";
@Controller("product-prices/workspace")
@StaffRoles("merchandising")
export class PriceApprovalController {
  constructor(private readonly approval: PriceApprovalService) {}
  @Get("pending") pending(
    @Query() q: QueuePageQuery,
    @Query("search") search?: string,
  ) {
    return this.approval.pending(
      search,
      queuePage(q) ?? { page: 1, limit: 20 },
    );
  }
  @Get("items/:sku") item(@Param("sku") sku: string) {
    return this.approval.itemFor(sku);
  }
  @Post("review") review(@Body() body: unknown) {
    return this.approval.review(body);
  }
  @Post("actions") save(@Body() body: unknown, @Req() req: StaffRequest) {
    return this.approval.save(body, req.staff.userId);
  }
  @Get("requests/:id") request(
    @Param("id") id: string,
    @Req() req: StaffRequest,
  ) {
    return this.approval.request(id, req.staff.userId);
  }
}
