import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Reservation } from './infrastructure/reservation.entity';
import { ReservationRepository } from './infrastructure/reservation.repository';
import { ReservationFacade } from './application/reservation.facade';
import { ReservationExpiryWorker } from './application/reservation-expiry.worker';
import { ReservationController } from './presentation/reservation.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Reservation])],
  controllers: [ReservationController],
  providers: [ReservationRepository, ReservationFacade, ReservationExpiryWorker],
  exports: [ReservationFacade, ReservationRepository],
})
export class ReservationModule {}
