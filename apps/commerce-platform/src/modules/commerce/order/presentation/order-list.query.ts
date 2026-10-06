import { IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../../../shared-kernel/application/pagination.dto';

export class OrderListQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  customerId?: string;
}
