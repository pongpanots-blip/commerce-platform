import { Entity, Unique } from 'typeorm';
import { ExternalMappingBase } from './external-mapping.base';

@Entity('product_mappings')
@Unique(['integrationId', 'externalId'])
@Unique(['integrationId', 'platformId'])
export class ProductMapping extends ExternalMappingBase {}
