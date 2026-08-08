import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TypeOrmBaseRepository } from '../../../../shared-kernel/infrastructure/typeorm-base.repository';
import { InventoryLevel } from './inventory-level.entity';

@Injectable()
export class InventoryRepository extends TypeOrmBaseRepository<InventoryLevel> {
  constructor(@InjectRepository(InventoryLevel) repo: Repository<InventoryLevel>) {
    super(repo);
  }
}
