import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OutboxMessage } from './outbox.entity';
import { EventEmitterBus } from './event-emitter.bus';
import { OutboxRelayWorker } from './outbox-relay.worker';
import { EVENT_BUS } from '../interfaces/event-bus.interface';

/**
 * Global event-bus module: binds the {@link EVENT_BUS} token to the outbox-backed
 * bus and runs the relay worker. Any module can inject `@Inject(EVENT_BUS)`.
 */
@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([OutboxMessage]),
  ],
  providers: [
    OutboxRelayWorker,
    EventEmitterBus,
    { provide: EVENT_BUS, useExisting: EventEmitterBus },
  ],
  exports: [EVENT_BUS],
})
export class EventBusModule {}
