/**
 * The token in an `Authorization: Bearer <token>` header, or null.
 *
 * One parser for every guard: two parsers that disagree on odd input
 * (`Bearer  <token>` with two spaces) let a request authenticate in one place
 * and look anonymous in another. Controllers and services must not read the
 * header at all; they take identity from `request.user`, which the guards set.
 */
export function readBearerToken(header: string | undefined): string | null {
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim() || null;
}
