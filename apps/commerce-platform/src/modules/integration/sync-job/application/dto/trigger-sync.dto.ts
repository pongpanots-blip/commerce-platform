import { IsIn, IsUUID } from 'class-validator';

export class TriggerSyncDto {
  @IsUUID()
  integrationId: string;

  @IsIn(['customers', 'products', 'inventory', 'prices'])
  operation: 'customers' | 'products' | 'inventory' | 'prices';
}
