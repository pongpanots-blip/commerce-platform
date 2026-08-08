import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TypeOrmBaseRepository } from '../../../../shared-kernel/infrastructure/typeorm-base.repository';
import { Payment } from './payment.entity';

@Injectable()
export class PaymentRepository extends TypeOrmBaseRepository<Payment> {
  constructor(@InjectRepository(Payment) public readonly orm: Repository<Payment>) {
    super(orm);
  }
}
