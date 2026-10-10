// Copied from josh origin/main 00030d02b apps/backend/src/app/marketing-workflow/marketing-expression.parser.ts — keep in sync by hand (phase 3 retires josh's copy).
/**
 * Safe expression DSL for `condition` workflow steps — see
 * `docs/superpowers/specs/2026-07-23-marketing-workflow-if-else-amendment.md`.
 *
 * This is a whitelist-only recursive-descent parser. It NEVER uses `eval` /
 * `new Function` / dynamic code execution — unknown fields, operators, or
 * value shapes are rejected as syntax errors instead of being passed through.
 *
 * Grammar:
 *   expr       := or_expr
 *   or_expr    := and_expr ( 'OR' and_expr )*
 *   and_expr   := atom ( 'AND' atom )*
 *   atom       := '(' expr ')' | comparison
 *   comparison := field op value
 */

export type MarketingExpressionField =
  | 'cart.still_open'
  | 'cart.item_count'
  | 'cart.total'
  | 'still_no_order'
  | 'segment.in'
  | 'user.order_count'
  | 'time.in_schedule'
  | 'time.hour'
  | 'time.dow'
  | 'page.views';

export type MarketingExpressionFieldType = 'boolean' | 'number' | 'segment';

export type ComparisonOperator = '==' | '!=' | '>' | '>=' | '<' | '<=';

export const MARKETING_EXPRESSION_FIELD_TYPES: Record<
  MarketingExpressionField,
  MarketingExpressionFieldType
> = {
  'cart.still_open': 'boolean',
  'cart.item_count': 'number',
  'cart.total': 'number',
  still_no_order: 'boolean',
  'segment.in': 'segment',
  'user.order_count': 'number',
  'time.in_schedule': 'boolean',
  'time.hour': 'number',
  'time.dow': 'number',
  'page.views': 'number',
};

export const MARKETING_EXPRESSION_FIELDS = Object.keys(
  MARKETING_EXPRESSION_FIELD_TYPES,
) as MarketingExpressionField[];

const ALLOWED_OPERATORS: Record<MarketingExpressionFieldType, ComparisonOperator[]> = {
  boolean: ['==', '!='],
  number: ['==', '!=', '>', '>=', '<', '<='],
  segment: ['==', '!='],
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ExpressionValue =
  | { kind: 'boolean'; value: boolean }
  | { kind: 'number'; value: number }
  | { kind: 'string'; value: string };

export type ExpressionNode =
  | { type: 'and'; left: ExpressionNode; right: ExpressionNode }
  | { type: 'or'; left: ExpressionNode; right: ExpressionNode }
  | {
      type: 'comparison';
      field: MarketingExpressionField;
      op: ComparisonOperator;
      value: ExpressionValue;
    };

export class MarketingExpressionSyntaxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MarketingExpressionSyntaxError';
  }
}

function isMarketingExpressionField(value: string): value is MarketingExpressionField {
  return Object.prototype.hasOwnProperty.call(MARKETING_EXPRESSION_FIELD_TYPES, value);
}

type Token =
  | { type: 'ident'; value: string }
  | { type: 'number'; value: number }
  | { type: 'string'; value: string }
  | { type: 'op'; value: ComparisonOperator }
  | { type: 'and' }
  | { type: 'or' }
  | { type: 'lparen' }
  | { type: 'rparen' };

function describeToken(token: Token | undefined): string {
  if (!token) return 'end of expression';
  switch (token.type) {
    case 'ident':
      return `identifier "${token.value}"`;
    case 'number':
      return `number ${token.value}`;
    case 'string':
      return `string "${token.value}"`;
    case 'op':
      return `operator "${token.value}"`;
    case 'and':
      return '"AND"';
    case 'or':
      return '"OR"';
    case 'lparen':
      return '"("';
    case 'rparen':
      return '")"';
  }
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = source.length;

  while (i < n) {
    const ch = source[i];

    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '(') {
      tokens.push({ type: 'lparen' });
      i++;
      continue;
    }
    if (ch === ')') {
      tokens.push({ type: 'rparen' });
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let j = i + 1;
      let value = '';
      while (j < n && source[j] !== quote) {
        value += source[j];
        j++;
      }
      if (j >= n) {
        throw new MarketingExpressionSyntaxError('Unterminated string literal');
      }
      tokens.push({ type: 'string', value });
      i = j + 1;
      continue;
    }
    if (ch === '=' && source[i + 1] === '=') {
      tokens.push({ type: 'op', value: '==' });
      i += 2;
      continue;
    }
    if (ch === '!' && source[i + 1] === '=') {
      tokens.push({ type: 'op', value: '!=' });
      i += 2;
      continue;
    }
    if (ch === '>' && source[i + 1] === '=') {
      tokens.push({ type: 'op', value: '>=' });
      i += 2;
      continue;
    }
    if (ch === '<' && source[i + 1] === '=') {
      tokens.push({ type: 'op', value: '<=' });
      i += 2;
      continue;
    }
    if (ch === '>') {
      tokens.push({ type: 'op', value: '>' });
      i++;
      continue;
    }
    if (ch === '<') {
      tokens.push({ type: 'op', value: '<' });
      i++;
      continue;
    }
    if (ch === '=') {
      throw new MarketingExpressionSyntaxError(
        `Unexpected "=" at position ${i}; did you mean "=="?`,
      );
    }
    if (ch === '!') {
      throw new MarketingExpressionSyntaxError(
        `Unexpected "!" at position ${i}; did you mean "!="?`,
      );
    }

    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      let value = '';
      while (j < n && /[A-Za-z0-9_.]/.test(source[j])) {
        value += source[j];
        j++;
      }
      const upper = value.toUpperCase();
      if (upper === 'AND') {
        tokens.push({ type: 'and' });
        i = j;
        continue;
      }
      if (upper === 'OR') {
        tokens.push({ type: 'or' });
        i = j;
        continue;
      }
      tokens.push({ type: 'ident', value });
      i = j;
      continue;
    }

    if (/[0-9]/.test(ch)) {
      let j = i;
      let seenDot = false;
      while (j < n && (/[0-9]/.test(source[j]) || (source[j] === '.' && !seenDot))) {
        if (source[j] === '.') seenDot = true;
        j++;
      }
      tokens.push({ type: 'number', value: Number(source.slice(i, j)) });
      i = j;
      continue;
    }

    throw new MarketingExpressionSyntaxError(`Unexpected character "${ch}" at position ${i}`);
  }

  return tokens;
}

class ExpressionParser {
  private pos = 0;

  constructor(private readonly tokens: Token[]) {}

  parse(): ExpressionNode {
    const node = this.parseOr();
    if (this.pos !== this.tokens.length) {
      const trailing = this.peek();
      if (trailing?.type === 'rparen') {
        throw new MarketingExpressionSyntaxError('Unbalanced parentheses: unexpected ")"');
      }
      throw new MarketingExpressionSyntaxError(
        `Unexpected ${describeToken(trailing)} after a complete expression`,
      );
    }
    return node;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private next(): Token {
    const token = this.tokens[this.pos];
    if (!token) {
      throw new MarketingExpressionSyntaxError('Unexpected end of expression');
    }
    this.pos++;
    return token;
  }

  private parseOr(): ExpressionNode {
    let node = this.parseAnd();
    while (this.peek()?.type === 'or') {
      this.next();
      const right = this.parseAnd();
      node = { type: 'or', left: node, right };
    }
    return node;
  }

  private parseAnd(): ExpressionNode {
    let node = this.parseAtom();
    while (this.peek()?.type === 'and') {
      this.next();
      const right = this.parseAtom();
      node = { type: 'and', left: node, right };
    }
    return node;
  }

  private parseAtom(): ExpressionNode {
    const token = this.peek();
    if (!token) {
      throw new MarketingExpressionSyntaxError('Unexpected end of expression');
    }
    if (token.type === 'lparen') {
      this.next();
      const node = this.parseOr();
      const close = this.peek();
      if (!close || close.type !== 'rparen') {
        throw new MarketingExpressionSyntaxError('Unbalanced parentheses: expected ")"');
      }
      this.next();
      return node;
    }
    if (token.type === 'rparen') {
      throw new MarketingExpressionSyntaxError('Unbalanced parentheses: unexpected ")"');
    }
    return this.parseComparison();
  }

  private parseComparison(): ExpressionNode {
    const fieldToken = this.next();
    if (fieldToken.type !== 'ident') {
      throw new MarketingExpressionSyntaxError(
        `Expected a field name, got ${describeToken(fieldToken)}`,
      );
    }
    if (!isMarketingExpressionField(fieldToken.value)) {
      throw new MarketingExpressionSyntaxError(`Unknown field "${fieldToken.value}"`);
    }
    const field = fieldToken.value;
    const fieldType = MARKETING_EXPRESSION_FIELD_TYPES[field];

    const opToken = this.next();
    if (opToken.type !== 'op') {
      throw new MarketingExpressionSyntaxError(
        `Expected a comparison operator after "${field}", got ${describeToken(opToken)}`,
      );
    }
    if (!ALLOWED_OPERATORS[fieldType].includes(opToken.value)) {
      throw new MarketingExpressionSyntaxError(
        `Operator "${opToken.value}" is not allowed for field "${field}"`,
      );
    }

    const valueToken = this.next();
    const value = this.parseValue(field, fieldType, valueToken);

    return { type: 'comparison', field, op: opToken.value, value };
  }

  private parseValue(
    field: MarketingExpressionField,
    fieldType: MarketingExpressionFieldType,
    token: Token,
  ): ExpressionValue {
    if (fieldType === 'boolean') {
      if (token.type !== 'ident' || (token.value !== 'true' && token.value !== 'false')) {
        throw new MarketingExpressionSyntaxError(
          `Field "${field}" requires a boolean literal (true/false), got ${describeToken(token)}`,
        );
      }
      return { kind: 'boolean', value: token.value === 'true' };
    }
    if (fieldType === 'number') {
      if (token.type !== 'number') {
        throw new MarketingExpressionSyntaxError(
          `Field "${field}" requires a numeric literal, got ${describeToken(token)}`,
        );
      }
      return { kind: 'number', value: token.value };
    }
    // segment
    if (token.type !== 'string') {
      throw new MarketingExpressionSyntaxError(
        `Field "${field}" requires a quoted string literal (e.g. "uuid"), got ${describeToken(token)}`,
      );
    }
    if (!UUID_RE.test(token.value)) {
      throw new MarketingExpressionSyntaxError(
        `Field "${field}" requires a valid UUID string literal`,
      );
    }
    return { kind: 'string', value: token.value };
  }
}

/**
 * Parses a marketing condition expression into a safe AST. Throws
 * `MarketingExpressionSyntaxError` on any invalid input — never executes
 * arbitrary code.
 */
export function parseMarketingExpression(source: string): ExpressionNode {
  if (typeof source !== 'string' || source.trim().length === 0) {
    throw new MarketingExpressionSyntaxError('Expression cannot be empty');
  }
  const tokens = tokenize(source);
  if (tokens.length === 0) {
    throw new MarketingExpressionSyntaxError('Expression cannot be empty');
  }
  return new ExpressionParser(tokens).parse();
}

/** Validates without throwing — used by the `validate-expression` endpoint. */
export function validateMarketingExpressionSyntax(source: string): { ok: boolean; error?: string } {
  try {
    parseMarketingExpression(source);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
