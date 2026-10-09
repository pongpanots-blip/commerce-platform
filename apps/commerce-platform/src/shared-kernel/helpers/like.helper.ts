/**
 * LIKE / ILIKE patterns from user input. `%`, `_` and `\` in a search are matched literally, so `%%` or `_`
 * does not match every row. Pair the pattern with `ESCAPE '\'` in the SQL (Postgres' default escape is also `\`,
 * the explicit clause keeps it that way whatever the server setting).
 */
export const escapeLike = (s: string) => s.replace(/\\/g, '\\\\').replace(/[%_]/g, '\\$&');

/** `%search%` with the search escaped, for `col ILIKE $n ESCAPE '\'`. */
export const containsPattern = (s: string) => `%${escapeLike(s)}%`;
