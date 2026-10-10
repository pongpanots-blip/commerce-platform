import { Controller, Get, Header, Param } from "@nestjs/common";
import { StaffRoles } from "../../../shared-kernel/presentation/auth.decorators";
import { ProductEvidenceService } from "./product-evidence.service";

@Controller("product-evidence")
@StaffRoles("merchandising")
export class ProductEvidenceController {
  constructor(private readonly evidence: ProductEvidenceService) {}
  @Get(":sku")
  @Header("Cache-Control", "private, no-store")
  item(@Param("sku") sku: string) {
    return this.evidence.item(sku);
  }
}
