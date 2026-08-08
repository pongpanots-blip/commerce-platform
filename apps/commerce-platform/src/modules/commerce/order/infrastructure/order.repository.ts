import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TypeOrmBaseRepository } from '../../../../shared-kernel/infrastructure/typeorm-base.repository';
import { Order } from './order.entity';

@Injectable()
export class OrderRepository extends TypeOrmBaseRepository<Order> {
  constructor(@InjectRepository(Order) public readonly orm: Repository<Order>) {
    super(orm);
  }
}
