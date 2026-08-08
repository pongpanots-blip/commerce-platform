import { Entity, Unique } from 'typeorm';
import { ExternalMappingBase } from './external-mapping.base';

@Entity('inventory_mappings')
@Unique(['integrationId', 'externalId'])
@Unique(['integrationId', 'platformId'])
export class InventoryMapping extends ExternalMappingBase {}
