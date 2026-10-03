import { UnauthorizedException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { Queue } from 'bullmq';
import { SignatureVerifier } from './application/signature-verifier';
import { WebhookReceiverService } from './application/webhook-receiver.service';
import { WebhookProcessor } from './application/webhook-processor.worker';
import { WebhookEvent } from './infrastructure/webhook-event.entity';
import { Integration } from '../integration/infrastructure/integration.entity';
import { IntegrationService } from '../integration/application/integration.service';
import { IEventBus } from '../../../shared-kernel/interfaces/event-bus.interface';
import { RETRY_JOB_OPTIONS } from '../../../config/redis.config';

const SECRET = 'shh';
const BODY = JSON.stringify({ hello: 'world' });

function webhookRepoMock() {
  return {
    create: jest.fn((x) => ({ id: 'wh-1', ...x })),
    save: jest.fn(async (x) => x),
    findOne: jest.fn(),
  } as unknown as jest.Mocked<Repository<WebhookEvent>>;
}

describe('SignatureVerifier', () => {
  const v = new SignatureVerifier();
  it('accepts a correct HMAC-SHA256 signature', () => {
    expect(v.verify(SECRET, BODY, v.sign(SECRET, BODY))).toBe(true);
  });
  it('rejects a wrong signature and a missing secret', () => {
    expect(v.verify(SECRET, BODY, 'deadbeef')).toBe(false);
    expect(v.verify(null, BODY, v.sign(SECRET, BODY))).toBe(false);
  });
});

describe('WebhookReceiverService', () => {
  const verifier = new SignatureVerifier();

  function make(integration: Partial<Integration> | null) {
    const webhookRepo = webhookRepoMock();
    const integrations = {
      resolve: jest.fn().mockResolvedValue(integration),
    } as unknown as IntegrationService;
    const queue = { add: jest.fn() } as unknown as Queue;
    const svc = new WebhookReceiverService(webhookRepo, integrations, verifier, queue);
    return { svc, webhookRepo, queue, integrations };
  }

  it('resolves by slug and stores the resolved integration id', async () => {
    const { svc, webhookRepo, integrations } = make({ id: 'int-1', signingSecret: SECRET });
    await svc.receive('shopify', {}, BODY, verifier.sign(SECRET, BODY));
    expect(integrations.resolve).toHaveBeenCalledWith('shopify');
    expect(webhookRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ integrationId: 'int-1' }),
    );
  });

  it('stores the raw payload and enqueues when the signature is valid', async () => {
    const { svc, webhookRepo, queue } = make({ id: 'int-1', signingSecret: SECRET });
    const saved = await svc.receive('int-1', {}, BODY, verifier.sign(SECRET, BODY));
    expect(webhookRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ payload: { hello: 'world' }, status: 'received', signatureValid: true }),
    );
    // Must carry retry options — BullMQ's default is a single attempt.
    expect(queue.add).toHaveBeenCalledWith('process', { webhookEventId: saved.id }, RETRY_JOB_OPTIONS);
  });

  it('rejects a bad signature with 401 and does NOT enqueue', async () => {
    const { svc, webhookRepo, queue } = make({ id: 'int-1', signingSecret: SECRET });
    await expect(svc.receive('int-1', {}, BODY, 'wrong')).rejects.toThrow(UnauthorizedException);
    expect(webhookRepo.save).toHaveBeenCalledWith(expect.objectContaining({ signatureValid: false }));
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('replay re-enqueues an existing webhook event by id', async () => {
    const { svc, webhookRepo, queue } = make({ id: 'int-1', signingSecret: SECRET });
    (webhookRepo.findOne as jest.Mock).mockResolvedValue({ id: 'wh-9' });
    await svc.replay('wh-9');
    expect(queue.add).toHaveBeenCalledWith('process', { webhookEventId: 'wh-9' });
  });
});

describe('WebhookProcessor', () => {
  it('publishes a domain event and marks the row processed', async () => {
    const row = { id: 'wh-1', integrationId: 'int-1', payload: { a: 1 }, status: 'received', attempts: 0 };
    const webhookRepo = webhookRepoMock();
    (webhookRepo.findOne as jest.Mock).mockResolvedValue(row);
    const eventBus = { publish: jest.fn() } as unknown as IEventBus;
    const worker = new WebhookProcessor(webhookRepo, eventBus);

    await worker.handle('wh-1');

    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'integration.webhook.received', aggregateId: 'int-1' }),
    );
    expect(webhookRepo.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'processed' }));
  });

  it('marks failed after max attempts when publishing keeps throwing', async () => {
    const row = { id: 'wh-2', integrationId: 'int-1', payload: {}, status: 'received', attempts: 4 };
    const webhookRepo = webhookRepoMock();
    (webhookRepo.findOne as jest.Mock).mockResolvedValue(row);
    const eventBus = { publish: jest.fn().mockRejectedValue(new Error('bus down')) } as unknown as IEventBus;
    const worker = new WebhookProcessor(webhookRepo, eventBus);

    await expect(worker.handle('wh-2')).rejects.toThrow('bus down');
    expect(webhookRepo.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', attempts: 5 }));
  });
});
