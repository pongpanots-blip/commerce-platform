import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Integration } from '../integration/infrastructure/integration.entity';
import { IntegrationModule } from '../integration.module';
import { ErpReservationGateway } from './erp-reservation.gateway';
import { RESERVATION_GATEWAY } from '../../commerce/reservation/domain/reservation-gateway.port';

/**
 * @Global so commerce-scope modules can inject RESERVATION_GATEWAY WITHOUT
 * importing anything from integration scope (dependency-inversion seam that
 * keeps the architecture fitness test honest).
 */
@Global()
@Module({
  imports: [IntegrationModule, TypeOrmModule.forFeature([Integration])],
  providers: [
    ErpReservationGateway,
    { provide: RESERVATION_GATEWAY, useExisting: ErpReservationGateway },
  ],
  exports: [RESERVATION_GATEWAY],
})
export class ReservationGatewayModule {}
