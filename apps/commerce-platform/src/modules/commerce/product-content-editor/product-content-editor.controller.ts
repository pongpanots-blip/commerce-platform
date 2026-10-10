import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import {
  StaffRequest,
  StaffRoles,
} from "../../../shared-kernel/presentation/auth.decorators";
import { ProductContentEditorService } from "./product-content-editor.service";

@Controller("product-content-editor")
@StaffRoles("merchandising", "graphic")
export class ProductContentEditorController {
  constructor(private readonly editor: ProductContentEditorService) {}
  @Get("items/:productId")
  @Header("Cache-Control", "private, no-store")
  item(@Param("productId") productId: string) {
    return this.editor.itemFor(productId);
  }
  @Post("review")
  @Header("Cache-Control", "private, no-store")
  review(@Body() body: unknown) {
    return this.editor.review(body);
  }
  @Get("requests/:id")
  @Header("Cache-Control", "private, no-store")
  request(@Param("id") id: string, @Req() req: StaffRequest) {
    return this.editor.request(id, req.staff.userId);
  }
}
