import { Type } from 'class-transformer';
import { IsNumber, IsUUID, Matches } from 'class-validator';

export class UpsertTargetDto {
  @IsUUID()
  sales_user_id: string;

  @Matches(/^\d{4}-\d{2}$/, {
    message: 'period_month must be YYYY-MM',
  })
  period_month: string;

  @Type(() => Number)
  @IsNumber({ allowInfinity: false, allowNaN: false })
  gmv_target: number;
}
