import { describe, expect, it } from 'vitest';
import { evenPercents, urlWarning } from './form-helpers';

describe('evenPercents', () => {
  it('always sums to 100', () => {
    for (const n of [2, 3, 4]) expect(evenPercents(n).reduce((a, b) => a + b, 0)).toBe(100);
    expect(evenPercents(3)).toEqual([34, 33, 33]);
  });
});

describe('urlWarning', () => {
  it('warns about non-http(s) and internal hosts, stays quiet for templates and public URLs', () => {
    expect(urlWarning('ftp://x.co')).toBe('scheme');
    expect(urlWarning('http://localhost:3000/x')).toBe('internal');
    expect(urlWarning('http://10.1.2.3/x')).toBe('internal');
    expect(urlWarning('http://172.20.0.1/')).toBe('internal');
    expect(urlWarning('http://[::1]/')).toBe('internal');
    expect(urlWarning('https://hooks.example/{{user_id}}')).toBeNull();
    expect(urlWarning('https://hooks.example/a')).toBeNull();
    expect(urlWarning('')).toBeNull();
  });
});
