import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { TypeOrmBaseRepository } from '../../../../shared-kernel/infrastructure/typeorm-base.repository';
import { Reservation } from './reservation.entity';

@Injectable()
export class ReservationRepository extends TypeOrmBaseRepository<Reservation> {
  constructor(@InjectRepository(Reservation) public readonly orm: Repository<Reservation>) {
    super(orm);
  }

  /** Raw find beyond the narrow IRepository port — the facade needs where-clauses. */
  find(where: FindOptionsWhere<Reservation>): Promise<Reservation[]> {
    return this.orm.find({ where });
  }

  /** Bulk column update (e.g. stamping expiresAt on all held rows for an order). */
  update(
    where: FindOptionsWhere<Reservation>,
    partial: QueryDeepPartialEntity<Reservation>,
  ): Promise<unknown> {
    return this.orm.update(where, partial);
  }
}
