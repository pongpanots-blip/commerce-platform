import { Entity, Unique } from 'typeorm';
import { ExternalMappingBase } from './external-mapping.base';

@Entity('customer_mappings')
@Unique(['integrationId', 'externalId'])
@Unique(['integrationId', 'platformId'])
export class CustomerMapping extends ExternalMappingBase {}
