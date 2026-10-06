import { IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../../../shared-kernel/application/pagination.dto';

export class InventoryListQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  productId?: string;
}
