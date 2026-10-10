// Copied from josh origin/main 00030d02b apps/backend/src/app/marketing-workflow/marketing-expression.parser.spec.ts — keep in sync by hand (phase 3 retires josh's copy).
import {
  MarketingExpressionSyntaxError,
  parseMarketingExpression,
  validateMarketingExpressionSyntax,
} from './expression.parser';

describe('parseMarketingExpression', () => {
  describe('valid examples from the amendment', () => {
    it('parses a simple boolean comparison', () => {
      expect(parseMarketingExpression('cart.still_open == true')).toEqual({
        type: 'comparison',
        field: 'cart.still_open',
        op: '==',
        value: { kind: 'boolean', value: true },
      });
    });

    it('parses a numeric comparison', () => {
      expect(parseMarketingExpression('cart.total >= 2000')).toEqual({
        type: 'comparison',
        field: 'cart.total',
        op: '>=',
        value: { kind: 'number', value: 2000 },
      });
    });

    it('parses still_no_order == true', () => {
      expect(parseMarketingExpression('still_no_order == true')).toEqual({
        type: 'comparison',
        field: 'still_no_order',
        op: '==',
        value: { kind: 'boolean', value: true },
      });
    });

    it('parses an AND of two comparisons', () => {
      expect(
        parseMarketingExpression('cart.item_count > 0 AND cart.total >= 1000'),
      ).toEqual({
        type: 'and',
        left: {
          type: 'comparison',
          field: 'cart.item_count',
          op: '>',
          value: { kind: 'number', value: 0 },
        },
        right: {
          type: 'comparison',
          field: 'cart.total',
          op: '>=',
          value: { kind: 'number', value: 1000 },
        },
      });
    });

    it('parses segment.in with a quoted UUID', () => {
      expect(
        parseMarketingExpression(
          'segment.in == "11111111-1111-1111-1111-111111111111"',
        ),
      ).toEqual({
        type: 'comparison',
        field: 'segment.in',
        op: '==',
        value: { kind: 'string', value: '11111111-1111-1111-1111-111111111111' },
      });
    });

    it('parses an OR of two comparisons', () => {
      expect(
        parseMarketingExpression('cart.still_open == true OR still_no_order == true'),
      ).toEqual({
        type: 'or',
        left: {
          type: 'comparison',
          field: 'cart.still_open',
          op: '==',
          value: { kind: 'boolean', value: true },
        },
        right: {
          type: 'comparison',
          field: 'still_no_order',
          op: '==',
          value: { kind: 'boolean', value: true },
        },
      });
    });

    it('parses parenthesized groups with AND/OR precedence', () => {
      const node = parseMarketingExpression(
        '(cart.total >= 1000 OR user.order_count > 3) AND cart.still_open == true',
      );
      expect(node.type).toBe('and');
      if (node.type === 'and') {
        expect(node.left.type).toBe('or');
        expect(node.right).toEqual({
          type: 'comparison',
          field: 'cart.still_open',
          op: '==',
          value: { kind: 'boolean', value: true },
        });
      }
    });

    it('AND binds tighter than OR (a OR b AND c == a OR (b AND c))', () => {
      const node = parseMarketingExpression(
        'still_no_order == true OR cart.item_count > 0 AND cart.total >= 1000',
      );
      expect(node.type).toBe('or');
      if (node.type === 'or') {
        expect(node.right.type).toBe('and');
      }
    });

    it('accepts all six comparison operators on numeric fields', () => {
      for (const op of ['==', '!=', '>', '>=', '<', '<=']) {
        expect(() => parseMarketingExpression(`user.order_count ${op} 2`)).not.toThrow();
      }
    });

    it('parses time.in_schedule == true', () => {
      expect(parseMarketingExpression('time.in_schedule == true')).toEqual({
        type: 'comparison',
        field: 'time.in_schedule',
        op: '==',
        value: { kind: 'boolean', value: true },
      });
    });

    it('parses time.hour and time.dow numeric comparisons', () => {
      expect(parseMarketingExpression('time.hour >= 9')).toEqual({
        type: 'comparison',
        field: 'time.hour',
        op: '>=',
        value: { kind: 'number', value: 9 },
      });
      expect(parseMarketingExpression('time.dow == 1')).toEqual({
        type: 'comparison',
        field: 'time.dow',
        op: '==',
        value: { kind: 'number', value: 1 },
      });
    });

    it('parses page.views numeric comparisons', () => {
      expect(parseMarketingExpression('page.views >= 3')).toEqual({
        type: 'comparison',
        field: 'page.views',
        op: '>=',
        value: { kind: 'number', value: 3 },
      });
    });

    it('is case-insensitive for AND/OR keywords', () => {
      expect(() =>
        parseMarketingExpression('cart.still_open == true and still_no_order == true'),
      ).not.toThrow();
      expect(() =>
        parseMarketingExpression('cart.still_open == true or still_no_order == true'),
      ).not.toThrow();
    });
  });

  describe('invalid examples (reject at save/activate)', () => {
    it('rejects an unknown field', () => {
      expect(() => parseMarketingExpression('cart.foo == true')).toThrow(
        MarketingExpressionSyntaxError,
      );
    });

    it('rejects an unknown top-level identifier', () => {
      expect(() => parseMarketingExpression('user.is_admin == true')).toThrow(/unknown field/i);
    });

    it('rejects an operator not allowed for the field type', () => {
      expect(() => parseMarketingExpression('cart.still_open > true')).toThrow(/operator/i);
    });

    it('rejects an empty expression', () => {
      expect(() => parseMarketingExpression('')).toThrow(/empty/i);
      expect(() => parseMarketingExpression('   ')).toThrow(/empty/i);
    });

    it('rejects unbalanced parentheses (missing close)', () => {
      expect(() => parseMarketingExpression('(cart.still_open == true')).toThrow(
        /parentheses/i,
      );
    });

    it('rejects unbalanced parentheses (extra close)', () => {
      expect(() => parseMarketingExpression('cart.still_open == true)')).toThrow(
        /parentheses/i,
      );
    });

    it('rejects a segment value without quotes', () => {
      expect(() =>
        parseMarketingExpression('segment.in == 11111111-1111-1111-1111-111111111111'),
      ).toThrow(MarketingExpressionSyntaxError);
    });

    it('rejects a segment value that is not a UUID', () => {
      expect(() => parseMarketingExpression('segment.in == "not-a-uuid"')).toThrow(/uuid/i);
    });

    it('rejects a numeric field compared against a boolean literal', () => {
      expect(() => parseMarketingExpression('cart.total == true')).toThrow(/numeric literal/i);
    });

    it('rejects a boolean field compared against a number', () => {
      expect(() => parseMarketingExpression('cart.still_open == 1')).toThrow(/boolean literal/i);
    });

    it('rejects time.in_schedule compared with a non-equality operator', () => {
      expect(() => parseMarketingExpression('time.in_schedule > true')).toThrow(/operator/i);
    });

    it('rejects time.hour compared against a boolean literal', () => {
      expect(() => parseMarketingExpression('time.hour == true')).toThrow(/numeric literal/i);
    });

    it('rejects a dangling AND/OR', () => {
      expect(() => parseMarketingExpression('cart.still_open == true AND')).toThrow();
      expect(() => parseMarketingExpression('AND cart.still_open == true')).toThrow();
    });

    it('rejects a single "=" (common typo for "==")', () => {
      expect(() => parseMarketingExpression('cart.still_open = true')).toThrow(/==/);
    });

    it('rejects garbage input', () => {
      expect(() => parseMarketingExpression('require("fs").readFileSync("/etc/passwd")')).toThrow(
        MarketingExpressionSyntaxError,
      );
    });

    it('rejects trailing tokens after a complete expression', () => {
      expect(() => parseMarketingExpression('cart.still_open == true true')).toThrow();
    });
  });

  describe('validateMarketingExpressionSyntax', () => {
    it('returns ok: true for a valid expression', () => {
      expect(validateMarketingExpressionSyntax('cart.total >= 2000')).toEqual({ ok: true });
    });

    it('returns ok: false with an error message for an invalid expression', () => {
      const result = validateMarketingExpressionSyntax('cart.foo == true');
      expect(result.ok).toBe(false);
      expect(result.error).toEqual(expect.any(String));
    });

    it('never throws regardless of input', () => {
      expect(() => validateMarketingExpressionSyntax('')).not.toThrow();
      expect(() => validateMarketingExpressionSyntax('((((')).not.toThrow();
    });
  });
});
