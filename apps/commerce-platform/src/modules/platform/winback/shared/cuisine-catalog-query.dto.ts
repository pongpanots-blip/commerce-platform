import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID } from 'class-validator';

export class CuisineCatalogQueryDto {
  /** Filter by parent cuisine — returns specialties (level 2) under this type. */
  @IsOptional()
  @IsUUID()
  parent_id?: string;

  /** Filter by hierarchy level: 1 = cuisine type, 2 = specialty. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn([1, 2])
  level?: number;

  /** Explicit language override (th/en). Defaults to th. */
  @IsOptional()
  @IsString()
  lang?: string;
}
