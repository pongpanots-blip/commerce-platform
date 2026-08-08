import { Entity, Unique } from 'typeorm';
import { ExternalMappingBase } from './external-mapping.base';

@Entity('order_mappings')
@Unique(['integrationId', 'externalId'])
@Unique(['integrationId', 'platformId'])
export class OrderMapping extends ExternalMappingBase {}
