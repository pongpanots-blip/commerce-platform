import { containsPattern, escapeLike } from './like.helper';

describe('LIKE patterns from user input', () => {
  it.each([
    ['%%', '%\\%\\%%'],
    ['_', '%\\_%'],
    ['a%b', '%a\\%b%'],
    ['a\\b', '%a\\\\b%'],
    ['a\\%', '%a\\\\\\%%'],
    ['acme', '%acme%'],
    ['ร้าน_อาหาร', '%ร้าน\\_อาหาร%'],
  ])('%s → %s', (search, pattern) => {
    expect(containsPattern(search)).toBe(pattern);
  });

  it('escapes the backslash first, so an escaped wildcard is not escaped twice', () => {
    expect(escapeLike('\\_')).toBe('\\\\\\_');
    expect(escapeLike('')).toBe('');
  });
});
