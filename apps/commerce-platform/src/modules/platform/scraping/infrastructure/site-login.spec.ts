import { randomBytes } from 'node:crypto';
import { decryptCredential, encryptCredential } from './credential-cipher';
import { parseSetCookie } from './public-web.reader';

describe('site login storage', () => {
  const previous = process.env.SCRAPING_CREDENTIALS_KEY;
  afterEach(() => { process.env.SCRAPING_CREDENTIALS_KEY = previous; });

  it('encrypts passwords with a fresh IV and refuses to work without a 32-byte key', () => {
    process.env.SCRAPING_CREDENTIALS_KEY = randomBytes(32).toString('base64');
    const a = encryptCredential('s3cret-รหัส'), b = encryptCredential('s3cret-รหัส');
    expect(a).not.toBe(b);
    expect(a).not.toContain('s3cret');
    expect(decryptCredential(a)).toBe('s3cret-รหัส');
    const [v, iv, tag, data] = a.split(':');
    expect(() => decryptCredential([v, iv, tag, Buffer.from('x' + Buffer.from(data, 'base64').toString('latin1')).toString('base64')].join(':'))).toThrow(/อ่านไม่ได้/);
    process.env.SCRAPING_CREDENTIALS_KEY = randomBytes(32).toString('base64');
    expect(() => decryptCredential(a)).toThrow(/อ่านไม่ได้/);
    process.env.SCRAPING_CREDENTIALS_KEY = '';
    expect(() => encryptCredential('x')).toThrow(/SCRAPING_CREDENTIALS_KEY/);
  });

  it('only accepts cookies for the responding site or its parent domain', () => {
    expect(parseSetCookie('sid=abc; Path=/; HttpOnly; Max-Age=60', 'https://accounts.shop.example/login')[0])
      .toMatchObject({ name: 'sid', value: 'abc', domain: 'accounts.shop.example', path: '/', httpOnly: true, secure: true });
    expect(parseSetCookie('sid=abc; Domain=.shop.example', 'https://accounts.shop.example/login')[0]).toMatchObject({ domain: '.shop.example' });
    expect(parseSetCookie('sid=abc; Domain=evil.example', 'https://accounts.shop.example/login')).toEqual([]);
    expect(parseSetCookie('broken', 'https://shop.example/')).toEqual([]);
  });
});
