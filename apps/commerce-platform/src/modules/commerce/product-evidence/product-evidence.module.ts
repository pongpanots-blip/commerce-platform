import { Module } from "@nestjs/common";
import { ProductEvidenceController } from "./product-evidence.controller";
import { ProductEvidenceService } from "./product-evidence.service";
@Module({
  controllers: [ProductEvidenceController],
  providers: [ProductEvidenceService],
})
export class ProductEvidenceModule {}
