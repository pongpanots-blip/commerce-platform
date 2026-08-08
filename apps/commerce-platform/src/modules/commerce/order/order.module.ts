import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order } from './infrastructure/order.entity';
import { OrderLine } from './infrastructure/order-line.entity';
import { OrderFulfillment } from './infrastructure/order-fulfillment.entity';
import { OrderRepository } from './infrastructure/order.repository';
import { OrderService } from './application/order.service';
import { OrderCheckoutSaga } from './application/order-checkout.saga';
import { OrderController } from './presentation/order.controller';
import { ReservationModule } from '../reservation/reservation.module';
import { SettingsModule } from '../../core/settings/settings.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, OrderLine, OrderFulfillment]),
    ReservationModule,
    SettingsModule,
  ],
  controllers: [OrderController],
  providers: [OrderRepository, OrderService, OrderCheckoutSaga],
  exports: [OrderService, OrderRepository, OrderCheckoutSaga],
})
export class OrderModule {}
