import { randomBytes } from 'node:crypto';
import { secretCipher } from './secret-cipher';

const messages = { missingKey: 'no key', malformed: 'bad format', wrongKey: 'wrong key' };
const ENV = 'TEST_SECRET_CIPHER_KEY';

describe('secretCipher', () => {
  afterEach(() => { delete process.env[ENV]; });

  it('round-trips and never stores the plain text', () => {
    process.env[ENV] = randomBytes(32).toString('base64');
    const c = secretCipher(ENV, messages);
    const stored = c.encrypt('Bearer abc');
    expect(stored).toMatch(/^v1:/);
    expect(stored).not.toContain('abc');
    expect(c.decrypt(stored)).toBe('Bearer abc');
    expect(c.configured()).toBe(true);
  });

  it('refuses without a 32-byte key', () => {
    const c = secretCipher(ENV, messages);
    expect(c.configured()).toBe(false);
    expect(() => c.encrypt('x')).toThrow('no key');
  });

  it('tells a malformed value from a changed key', () => {
    process.env[ENV] = randomBytes(32).toString('base64');
    const stored = secretCipher(ENV, messages).encrypt('x');
    expect(() => secretCipher(ENV, messages).decrypt('nope')).toThrow('bad format');
    process.env[ENV] = randomBytes(32).toString('base64');
    expect(() => secretCipher(ENV, messages).decrypt(stored)).toThrow('wrong key');
  });
});
