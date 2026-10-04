import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Interval } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Client } from 'pg';
import { Repository } from 'typeorm';
import { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';
import { OutboxMessage } from './outbox.entity';

const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 50;
/** Postgres channel the event bus NOTIFYs inside the writing transaction — delivered only on commit. */
export const OUTBOX_CHANNEL = 'outbox_pending';
/** One relay at a time across all instances, so events leave in the order they were written. */
const RELAY_LOCK_KEY = 7_340_001;
const RELISTEN_MS = 5_000;

/**
 * Drains pending outbox rows: emits each event in-process (EventEmitter2) and
 * marks the row published. Woken by Postgres NOTIFY the moment the writing
 * transaction commits (milliseconds), with a 2s poll as the backstop when the
 * LISTEN connection is down. Rows go out strictly oldest-first and each event's
 * listeners finish before the next (emitAsync) — the webhook dispatcher relies
 * on that to queue deliveries in order (platforms like josh have no guard
 * against an older stock value arriving last). Failures increment `attempts`
 * and flip to `failed` past the max, so a poison row cannot wedge the relay.
 */
@Injectable()
export class OutboxRelayWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxRelayWorker.name);
  private running = false;
  private again = false;
  private listener: Client | null = null;
  private closed = false;

  constructor(
    @InjectRepository(OutboxMessage)
    private readonly outboxRepo: Repository<OutboxMessage>,
    private readonly emitter: EventEmitter2,
  ) {}

  onModuleInit() {
    void this.listen();
  }

  async onModuleDestroy() {
    this.closed = true;
    await this.listener?.end().catch(() => undefined);
  }

  private async listen(): Promise<void> {
    if (this.closed) return;
    const o = this.outboxRepo.manager.connection.options as PostgresConnectionOptions;
    const client = new Client({
      connectionString: o.url, host: o.host, port: o.port, user: o.username,
      password: typeof o.password === 'string' ? o.password : undefined, database: o.database, ssl: o.ssl as never,
    });
    const retry = (error: unknown) => {
      if (this.closed || this.listener !== client) return;
      this.listener = null;
      this.logger.warn(`outbox LISTEN lost (${error instanceof Error ? error.message : error}) — polling every 2s until it reconnects`);
      client.end().catch(() => undefined);
      setTimeout(() => void this.listen(), RELISTEN_MS).unref();
    };
    client.on('notification', () => void this.processPending());
    client.on('error', retry);
    client.on('end', () => retry('connection ended'));
    this.listener = client;
    try {
      await client.connect();
      await client.query(`LISTEN ${OUTBOX_CHANNEL}`);
    } catch (error) {
      retry(error);
    }
  }

  /** Runs until the outbox is empty; a wake-up during a run makes it go round once more instead of overlapping. */
  @Interval(2000)
  async processPending(): Promise<void> {
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = true;
    try {
      do {
        this.again = false;
        while ((await this.relayBatch()) === BATCH_SIZE);
      } while (this.again);
    } catch (error) {
      this.logger.error(`outbox relay failed: ${error instanceof Error ? error.message : error}`);
    } finally {
      this.running = false;
    }
  }

  /** Returns how many rows it handled (0 when another instance holds the relay lock). */
  private relayBatch(): Promise<number> {
    return this.outboxRepo.manager.transaction(async (manager) => {
      const [{ locked }] = await manager.query('SELECT pg_try_advisory_xact_lock($1) AS locked', [RELAY_LOCK_KEY]);
      if (!locked) return 0;
      const repo = manager.getRepository(OutboxMessage);
      const pending = await repo.find({ where: { status: 'pending' }, order: { createdAt: 'ASC' }, take: BATCH_SIZE });

      for (const row of pending) {
        try {
          await this.emitter.emitAsync(row.type, {
            eventId: row.id,
            type: row.type,
            aggregateId: row.aggregateId,
            payload: row.payload,
            metadata: row.metadata,
            occurredAt: row.createdAt,
          });
          row.status = 'published';
          row.publishedAt = new Date();
        } catch (error) {
          row.attempts += 1;
          if (row.attempts >= MAX_ATTEMPTS) {
            row.status = 'failed';
            this.logger.error(
              `Outbox row ${row.id} (${row.type}) failed after ${row.attempts} attempts`,
              error instanceof Error ? error.stack : String(error),
            );
          }
        }
      }
      if (pending.length) await repo.save(pending);
      return pending.length;
    });
  }
}
