import { loginPage } from './mcp-login.page';

// client_name comes from dynamic client registration, i.e. from anyone on the internet.
it('escapes the self-registered client name and the request id', () => {
  const html = loginPage({ requestId: '"><script>x()</script>', clientName: '<img src=x onerror=alert(1)> & co' });
  expect(html).not.toContain('<script>x()');
  expect(html).not.toContain('<img src=x');
  expect(html).toContain('&lt;img src=x onerror=alert(1)&gt; &amp; co');
  expect(html).toContain('value="&quot;&gt;&lt;script&gt;x()&lt;/script&gt;"');
  expect(html).toContain('action="/mcp/oauth/login"');
  expect(html).not.toContain('role="alert"');
  expect(loginPage({ requestId: 'r', clientName: 'c', error: 'bad' })).toContain('role="alert">bad<');
});
