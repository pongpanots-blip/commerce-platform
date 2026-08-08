import { Entity, Unique } from 'typeorm';
import { ExternalMappingBase } from './external-mapping.base';

@Entity('supplier_mappings')
@Unique(['integrationId', 'externalId'])
@Unique(['integrationId', 'platformId'])
export class SupplierMapping extends ExternalMappingBase {}
