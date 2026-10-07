import { Module } from '@nestjs/common';
import { ProductPromotionRulesService } from './product-promotion-rules.service';
import { ProductPromotionRulesController } from './product-promotion-rules.controller';
@Module({ controllers: [ProductPromotionRulesController], providers: [ProductPromotionRulesService], exports: [ProductPromotionRulesService] })
export class ProductPromotionRulesModule {}
