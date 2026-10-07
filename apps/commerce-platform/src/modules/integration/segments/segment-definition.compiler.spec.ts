import { BadRequestException } from '@nestjs/common';
import { SegmentDefinitionCompiler } from './segment-definition.compiler';
import { SegmentDefinition } from './dto/segment-definition.dto';

describe('SegmentDefinitionCompiler', () => {
  const compiler = new SegmentDefinitionCompiler();
  const compile = (def: SegmentDefinition) => compiler.compile(def);

  it('compiles a single leaf to parameterized SQL', () => {
    const { where, params } = compile({ field: 'lifetime_spend', operator: '<', value: 1000 });
    expect(where).toBe('(COALESCE(m.lifetime_spend,0) < $1::numeric)');
    expect(params).toEqual([1000]);
  });

  it('compiles nested AND/OR with correct param indexes', () => {
    const def: SegmentDefinition = {
      op: 'AND',
      children: [
        { field: 'lifetime_spend', operator: '<', value: 1000 },
        {
          op: 'OR',
          children: [
            { field: 'last_order_days_ago', operator: '>=', value: 30 },
            { field: 'tier', operator: 'in', value: ['silver'] },
          ],
        },
      ],
    };
    const { where, params } = compile(def);
    expect(params).toEqual([1000, 30, 'silver']);
    expect(where).toContain(' AND ');
    expect(where).toContain(' OR ');
    expect(where).toBe(
      '((COALESCE(m.lifetime_spend,0) < $1::numeric) AND ' +
        '((COALESCE(EXTRACT(DAY FROM now() - m.last_order_at), 999999) >= $2::numeric) OR ' +
        '(t.slug IN ($3))))',
    );
  });

  it('compiles "between" pushing both bounds as separate params', () => {
    const { where, params } = compile({
      field: 'lifetime_spend',
      operator: 'between',
      value: [100, 500],
    });
    expect(where).toBe('(COALESCE(m.lifetime_spend,0) BETWEEN $1::numeric AND $2::numeric)');
    expect(params).toEqual([100, 500]);
  });

  it('compiles "in" with multiple values into a single IN list', () => {
    const { where, params } = compile({
      field: 'tier',
      operator: 'in',
      value: ['silver', 'gold', 'platinum'],
    });
    expect(where).toBe('(t.slug IN ($1,$2,$3))');
    expect(params).toEqual(['silver', 'gold', 'platinum']);
  });

  it('rejects unknown field', () => {
    expect(() =>
      compile({ field: 'x', operator: '<', value: 1 } as unknown as SegmentDefinition),
    ).toThrow(BadRequestException);
  });

  it('rejects operator not allowed for field', () => {
    // 'in' is not in NUMERIC_OPERATORS for lifetime_spend.
    expect(() =>
      compile({ field: 'lifetime_spend', operator: 'in', value: [1] }),
    ).toThrow(BadRequestException);
    expect(() => compile({ field: 'lifetime_spend', operator: 'in', value: [1] })).toThrow(
      /not allowed for field "lifetime_spend"/,
    );
  });

  it('rejects "between" given something other than a 2-element array', () => {
    expect(() =>
      compile({ field: 'lifetime_spend', operator: 'between', value: [1] as unknown as [number, number] }),
    ).toThrow(BadRequestException);
  });

  it('rejects "in" given an empty array', () => {
    expect(() => compile({ field: 'tier', operator: 'in', value: [] })).toThrow(
      BadRequestException,
    );
  });

  it('rejects a scalar operator given an array value', () => {
    expect(() =>
      compile({ field: 'lifetime_spend', operator: '<', value: [1, 2] as unknown as number }),
    ).toThrow(BadRequestException);
  });

  it('rejects an unknown branch operator', () => {
    expect(() =>
      compile({
        op: 'XOR' as unknown as 'AND',
        children: [{ field: 'lifetime_spend', operator: '<', value: 1 }],
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects a branch with no children', () => {
    expect(() => compile({ op: 'AND', children: [] })).toThrow(BadRequestException);
  });

  it('rejects a prototype-pollution field key (__proto__/toString) as unknown', () => {
    expect(() =>
      compile({ field: '__proto__', operator: '=', value: 1 } as unknown as SegmentDefinition),
    ).toThrow(BadRequestException);
    expect(() =>
      compile({ field: 'toString', operator: '=', value: 1 } as unknown as SegmentDefinition),
    ).toThrow(BadRequestException);
    expect(() =>
      compile({ field: 'constructor', operator: '=', value: 1 } as unknown as SegmentDefinition),
    ).toThrow(BadRequestException);
  });

  it('rejects a tree nested too deeply instead of overflowing the stack', () => {
    let node: SegmentDefinition = { field: 'lifetime_spend', operator: '<', value: 1 };
    for (let i = 0; i < 500; i++) {
      node = { op: 'AND', children: [node] };
    }
    expect(() => compile(node)).toThrow(BadRequestException);
    expect(() => compile(node)).toThrow(/nested too deeply/);
  });

  it('keeps values as bound params (injection attempt is inert)', () => {
    const injected = "'; DROP TABLE users;--";
    const { where, params } = compile({ field: 'custype', operator: '=', value: injected });
    expect(where).toBe('(u.custype = $1)');
    expect(where).not.toContain('DROP TABLE');
    expect(params[0]).toBe(injected);
  });

  it('keeps every element of an injection-laden "in" list as separate bound params', () => {
    // `tier` (not `manual_user_ids`) here: manual_user_ids now requires
    // every value to be a real UUID (see the "manual_user_ids" describe
    // block below), so an injection string can't be used as its value
    // without being rejected before it ever reaches compileLeaf — the
    // param-safety guarantee this test is about is orthogonal to that and
    // still holds for any "in" field.
    const injected = "x'); DROP TABLE users;--";
    const { where, params } = compile({
      field: 'tier',
      operator: 'in',
      value: [injected, 'gold'],
    });
    expect(where).toBe('(t.slug IN ($1,$2))');
    expect(where).not.toContain('DROP TABLE');
    expect(params).toEqual([injected, 'gold']);
  });

  it('treats never-ordered (NULL last_order_at) as infinitely long ago', () => {
    // The field registry's sqlExpr for last_order_days_ago already
    // COALESCEs a NULL last_order_at (never ordered) to 999999 days, so
    // the compiler's job is simply to emit that expression verbatim —
    // confirm it does, rather than re-deriving NULL handling here.
    const { where, params } = compile({
      field: 'last_order_days_ago',
      operator: '>=',
      value: 30,
    });
    expect(where).toBe(
      '(COALESCE(EXTRACT(DAY FROM now() - m.last_order_at), 999999) >= $1::numeric)',
    );
    expect(params).toEqual([30]);
  });

  describe('validate', () => {
    it('does not throw for a well-formed definition', () => {
      expect(() =>
        compiler.validate({ field: 'lifetime_spend', operator: '<', value: 1000 }),
      ).not.toThrow();
    });

    it('throws BadRequestException (not a generic Error) for an unknown field', () => {
      expect(() =>
        compiler.validate({ field: 'not_a_field', operator: '=', value: 1 }),
      ).toThrow(BadRequestException);
    });
  });

  // Bug fix: these value shapes used to pass `validate` (only a JS-type
  // check) and then throw a raw Postgres error at query time — `invalid
  // input syntax for type uuid`/`integer` — surfacing as a 500 on save,
  // preview, and (once saved+active) on every `/resolve` call.
  describe('validate — value shape against the field, not just its JS type', () => {
    it('rejects a manual_user_ids value that is not a UUID', () => {
      expect(() =>
        compiler.validate({ field: 'manual_user_ids', operator: 'in', value: ['CUST001'] }),
      ).toThrow(/manual_user_ids.*UUID/);
    });

    it('rejects a manual_user_ids email the same way', () => {
      expect(() =>
        compiler.validate({
          field: 'manual_user_ids',
          operator: 'in',
          value: ['someone@example.com'],
        }),
      ).toThrow(BadRequestException);
    });

    it('accepts a real UUID for manual_user_ids', () => {
      expect(() =>
        compiler.validate({
          field: 'manual_user_ids',
          operator: 'in',
          value: ['11111111-1111-1111-1111-111111111111'],
        }),
      ).not.toThrow();
    });

    it('rejects a non-numeric string against a numeric field', () => {
      expect(() =>
        compiler.validate({ field: 'lifetime_order_count', operator: '>', value: 'not-a-number' }),
      ).toThrow(/lifetime_order_count.*numeric/);
    });

    it('accepts a numeric string against a numeric field (definitions may store values as strings)', () => {
      expect(() =>
        compiler.validate({ field: 'lifetime_order_count', operator: '>', value: '5' }),
      ).not.toThrow();
    });

    it('accepts a decimal against an integer-column field (order_count_90d) instead of rejecting it', () => {
      expect(() =>
        compiler.validate({ field: 'order_count_90d', operator: '>', value: 1.5 }),
      ).not.toThrow();
    });

    // Bug fix (round 2): `Number('')` and `Number('  ')` are `0`, not `NaN`
    // — the numeric-string coercion above happily accepted an empty or
    // whitespace-only string as "0" and let it through, then Postgres threw
    // `invalid input syntax for type numeric: ""` at query time (500).
    it('rejects an empty string against a numeric field instead of silently coercing it to 0', () => {
      expect(() =>
        compiler.validate({ field: 'lifetime_spend', operator: '>', value: '' }),
      ).toThrow(BadRequestException);
      expect(() =>
        compiler.validate({ field: 'lifetime_spend', operator: '>', value: '' }),
      ).toThrow(/lifetime_spend.*numeric/);
    });

    it('rejects a whitespace-only string against a numeric field', () => {
      expect(() =>
        compiler.validate({ field: 'lifetime_spend', operator: '>', value: '   ' }),
      ).toThrow(BadRequestException);
    });

    it('rejects an empty string inside a "between" array, not just the scalar form', () => {
      expect(() =>
        compiler.validate({ field: 'lifetime_spend', operator: 'between', value: ['', 500] }),
      ).toThrow(BadRequestException);
    });

    it('rejects an empty string inside an "in" array, not just the scalar form', () => {
      expect(() =>
        compiler.validate({ field: 'order_count_90d', operator: 'in', value: [1, ''] }),
      ).toThrow(BadRequestException);
    });

    it('compile() itself throws for an empty string instead of ever reaching Postgres', () => {
      expect(() =>
        compile({ field: 'lifetime_spend', operator: '>', value: '' as unknown as number }),
      ).toThrow(BadRequestException);
    });

    it('rejects a boolean against a numeric field', () => {
      expect(() =>
        compiler.validate({ field: 'lifetime_spend', operator: '>', value: true as unknown as number }),
      ).toThrow(BadRequestException);
    });

    it('rejects junk against has_company', () => {
      expect(() =>
        compiler.validate({ field: 'has_company', operator: '=', value: 'yes-please' }),
      ).toThrow(/has_company.*boolean/);
    });

    it("accepts has_company as a boolean or the strings 'true'/'false'", () => {
      expect(() =>
        compiler.validate({ field: 'has_company', operator: '=', value: true }),
      ).not.toThrow();
      expect(() =>
        compiler.validate({ field: 'has_company', operator: '=', value: 'false' }),
      ).not.toThrow();
    });
  });

  describe('compile — numeric params get an explicit ::numeric cast', () => {
    it('casts a scalar comparison on a numeric field', () => {
      const { where, params } = compile({
        field: 'order_count_90d',
        operator: '>',
        value: 1.5,
      });
      expect(where).toBe('(COALESCE(m.order_count_90d,0) > $1::numeric)');
      expect(params).toEqual([1.5]);
    });

    it('casts both bounds of a "between" on a numeric field', () => {
      const { where, params } = compile({
        field: 'lifetime_spend',
        operator: 'between',
        value: [100, 500],
      });
      expect(where).toBe('(COALESCE(m.lifetime_spend,0) BETWEEN $1::numeric AND $2::numeric)');
      expect(params).toEqual([100, 500]);
    });

    it('does not cast a non-numeric field (tier stays a plain placeholder)', () => {
      const { where } = compile({ field: 'tier', operator: '=', value: 'gold' });
      expect(where).toBe('(t.slug = $1)');
    });
  });

  describe('cuisine_group field', () => {
    it('compiles to a text comparison on cy.parent_id', () => {
      const { where, params } = compile({
        field: 'cuisine_group',
        operator: '=',
        value: 'group-uuid',
      });
      expect(where).toBe('(cy.parent_id::text = $1)');
      expect(params).toEqual(['group-uuid']);
    });
  });
});
