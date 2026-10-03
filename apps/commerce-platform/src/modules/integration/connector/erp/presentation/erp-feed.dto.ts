import { Transform, TransformFnParams, Type } from 'class-transformer';
import { IsNotEmpty, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';

/**
 * Wire DTOs for the Jagota ERP feed — copied from
 * josh/apps/backend/src/app/erp/dto/erp-webhook.dto.ts with ONLY the namespace
 * changed. Field names are the ERP contract (docs/erp-integration-tasks.md §5):
 * never rename or camelCase them. erp-feed.dto.spec.ts pins the names.
 */

const nullToZero = ({ value }: TransformFnParams): unknown =>
  value === null ? 0 : value;

export class ProductQtyItemDto {
  @IsNotEmpty()
  @IsString()
  PRODUCT_CODE!: string;

  /** ≥1 = in stock · <1 = out of stock · null → 0 */
  @Transform(nullToZero)
  @IsNotEmpty()
  @IsNumber()
  QUANTITY!: number;

  /** เวลาที่ ERP เปลี่ยน — กัน event เก่ามาทับค่าใหม่ */
  @IsOptional()
  @IsString()
  CHANGED_AT?: string;

  /** SALE / RECEIVE / ADJUST */
  @IsOptional()
  @IsString()
  REASON?: string;
}

export class ProductMoqItemDto {
  @IsNotEmpty() @IsString() PRODUCT_CODE!: string;
  @IsNotEmpty() @IsNumber() MOQ!: number;
}

export class ProductPriceValueDto {
  @IsOptional() @IsNumber() ORDERING_PRICE?: number;
  @IsOptional() @IsNumber() SELLING_UNIT_PRICE?: number;
}

export class ProductPriceItemDto {
  @IsNotEmpty()
  @IsString()
  PRODUCT_CODE!: string;

  @ValidateNested()
  @Type(() => ProductPriceValueDto)
  PRICE!: ProductPriceValueDto;
}
