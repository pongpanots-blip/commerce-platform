import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TypeOrmBaseRepository } from '../../../../shared-kernel/infrastructure/typeorm-base.repository';
import { Product } from './product.entity';

@Injectable()
export class ProductRepository extends TypeOrmBaseRepository<Product> {
  constructor(@InjectRepository(Product) repo: Repository<Product>) {
    super(repo);
  }
}
