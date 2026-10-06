import { z } from 'zod';
import { previewWorkflow, toJoshWorkflow, workflowDraftSchema } from './mcp-workflow-draft';

const schema = z.object(workflowDraftSchema);

describe('MCP marketing workflow draft', () => {
  it('sends only josh DTO fields — never confirmCode or a status', () => {
    const body = toJoshWorkflow({ name: 'Cart reminder', trigger_type: 'cart_idle', confirmCode: 'abc', status: 'active' } as never);
    expect(body).toEqual({ name: 'Cart reminder', trigger_type: 'cart_idle' });
  });

  it('rejects unknown trigger types and out-of-range numbers', () => {
    expect(schema.safeParse({ name: 'x', trigger_type: 'blast_everyone' }).success).toBe(false);
    expect(schema.safeParse({ name: 'x', holdout_percent: 120 }).success).toBe(false);
    expect(schema.safeParse({ name: ' ' }).success).toBe(false);
    expect(schema.safeParse({ name: 'x', steps: [{ id: 's1' }] }).success).toBe(false); // step needs a type
  });

  it('previews steps and notify channels and says it is a draft', () => {
    const p = previewWorkflow({
      name: 'Cart reminder',
      trigger_type: 'cart_idle',
      steps: [
        { id: 'w', type: 'wait', hours: 2 },
        { id: 'n', type: 'action', action: { kind: 'notify', channels: ['push', 'email'], templateKey: 'cart_reminder' } },
      ],
    } as never);
    expect(p).toMatchObject({ name: 'Cart reminder', trigger: 'cart_idle', steps: 2, stepTypes: ['wait', 'action:notify'], notifyChannels: ['push', 'email'] });
    expect(p.action).toContain('DRAFT');
  });
});
