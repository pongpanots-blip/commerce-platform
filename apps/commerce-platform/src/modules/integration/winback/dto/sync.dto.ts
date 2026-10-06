import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class SyncDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(3650) days?: number;
}
