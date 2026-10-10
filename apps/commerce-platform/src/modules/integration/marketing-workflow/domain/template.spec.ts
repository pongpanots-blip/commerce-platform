import { renderTemplate, renderWebhook, secretIdsOf, webhookVars } from './template';

const vars = { user_name: 'Nok "the" Boss\r\nX-Evil: 1', user_email: 'a&b@x.co' };
const ctx = { userId: 'u1', workflowId: 'w1', workflowName: 'Welcome', enrollmentId: 'e1', stepId: 's1' };

describe('renderTemplate', () => {
  it('keeps a JSON body valid whatever the value holds', () => {
    const body = renderTemplate('{"name":"{{user_name}}"}', vars, 'json');
    expect(JSON.parse(body).name).toBe(vars.user_name);
  });
  it('cannot inject a header line', () => expect(renderTemplate('{{user_name}}', vars, 'header')).not.toMatch(/[\r\n]/));
  it('encodes values in a URL', () => expect(renderTemplate('https://h.co/?e={{user_email}}', vars, 'url')).toBe('https://h.co/?e=a%26b%40x.co'));
  it('leaves unknown variables and secret refs alone', () =>
    expect(renderTemplate('{{nope}} {{secret:11111111-1111-4111-8111-111111111111}}', vars, 'text'))
      .toBe('{{nope}} {{secret:11111111-1111-4111-8111-111111111111}}'));
});

describe('webhookVars / renderWebhook', () => {
  it('builds josh-style names from the customer copy plus workflow ids', () => {
    const v = webhookVars({ first_name: 'Nok', last_name: 'S', email: 'n@x.co', mobile_phone: '081' }, ctx);
    expect(v).toMatchObject({ user_name: 'Nok S', user_email: 'n@x.co', user_phone: '081', workflow_name: 'Welcome', step_id: 's1' });
  });
  it('renders url / headers / body and treats the body as JSON unless content-type says otherwise', () => {
    const step = { id: 's1', type: 'webhook' as const, method: 'POST' as const, url: 'https://h.co/{{user_email}}',
      headers: [{ key: 'X-Name', value: '{{user_name}}' }, { key: 'Authorization', value: '{{secret:11111111-1111-4111-8111-111111111111}}' }],
      body: '{"n":"{{user_name}}"}', nextId: null };
    const out = renderWebhook(step, vars);
    expect(out.url).toBe('https://h.co/a%26b%40x.co');
    expect(out.headers[0].value).not.toMatch(/[\r\n]/);
    expect(JSON.parse(out.body!).n).toBe(vars.user_name);
    expect(secretIdsOf(out.headers)).toEqual(['11111111-1111-4111-8111-111111111111']);
    const text = renderWebhook({ ...step, headers: [{ key: 'content-type', value: 'text/plain' }] }, vars);
    expect(text.body).toBe(`{"n":"${vars.user_name}"}`);
  });
  it('sends no body for GET', () =>
    expect(renderWebhook({ id: 's', type: 'webhook', method: 'GET', url: 'https://h.co', headers: [], body: 'x', nextId: null }, {}).body).toBeNull());
});
