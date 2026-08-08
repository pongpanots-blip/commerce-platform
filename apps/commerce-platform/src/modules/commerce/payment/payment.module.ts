import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Payment } from './infrastructure/payment.entity';
import { PaymentRepository } from './infrastructure/payment.repository';
import { PaymentService } from './application/payment.service';
import { PaymentController } from './presentation/payment.controller';
import { OrderModule } from '../order/order.module';

@Module({
  imports: [TypeOrmModule.forFeature([Payment]), OrderModule],
  controllers: [PaymentController],
  providers: [PaymentRepository, PaymentService],
  exports: [PaymentService],
})
export class PaymentModule {}
