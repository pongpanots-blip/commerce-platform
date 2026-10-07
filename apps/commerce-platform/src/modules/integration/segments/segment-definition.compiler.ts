/**
 * SegmentDefinitionCompiler (Task 5 of the SEGMENTS/TIERS plan).
 *
 * Turns a `SegmentDefinition` boolean condition tree (see
 * `dto/segment-definition.dto.ts`) into a single parameterized SQL WHERE
 * clause fragment: `{ where: string, params: unknown[] }`, suitable for
 * splicing into the base query documented in `segment-fields.ts`
 * (`users u LEFT JOIN customer_metrics m ... LEFT JOIN membership_tiers t
 * ON t.id = COALESCE(m.tier_id, <entry-tier fallback>) ...`).
 *
 * Injection safety: the only strings that can end up verbatim in the SQL
 * text are (a) `FieldDef.sqlExpr`, which comes exclusively from the
 * hardcoded `SEGMENT_FIELDS` registry — never from the request — and
 * (b) the SQL operator token, which is looked up from the fixed
 * `SQL_OPERATORS` whitelist keyed by the registry's `Operator` union,
 * never interpolated from the raw request string. Every user-supplied
 * VALUE (leaf.value, and each element for `in`/`between`) is pushed onto
 * `params` and referenced only via a `$n` placeholder — it is never
 * concatenated into the `where` string. A value like
 * `"'; DROP TABLE users;--"` therefore always lands as a single bound
 * parameter and is inert as SQL text.
 */

import { Injectable, BadRequestException } from '@nestjs/common';
import { FieldDef, getField, Operator, SEGMENT_FIELDS } from './segment-fields';
import {
  SegmentBranch,
  SegmentDefinition,
  SegmentLeaf,
  isSegmentBranch,
} from './dto/segment-definition.dto';
import { isUuid } from './segment-base';

/**
 * Fixed whitelist mapping the registry's `Operator` union to the literal
 * SQL token used in the generated WHERE clause. This is the ONLY source of
 * SQL operator text — an operator not present here is rejected by
 * `validate` (and, defensively, by `compile`) rather than ever being
 * interpolated.
 */
const SQL_OPERATORS: Record<Operator, string> = {
  '<': '<',
  '<=': '<=',
  '>': '>',
  '>=': '>=',
  '=': '=',
  '!=': '!=',
  between: 'BETWEEN',
  in: 'IN',
};

/**
 * Maximum nesting depth of the condition tree. A hostile or buggy client
 * could send a tree thousands of levels deep; without a bound the recursive
 * walk would overflow the call stack (RangeError → uncaught 500) instead of
 * a clean 400. 100 is far deeper than any realistic hand-built segment.
 */
const MAX_DEPTH = 100;

export type CompiledSegmentDefinition = {
  where: string;
  params: unknown[];
};

@Injectable()
export class SegmentDefinitionCompiler {
  /**
   * Validates and compiles a segment definition tree into a single
   * parameterized WHERE clause with a shared, monotonically increasing
   * `$n` param counter across the whole tree (so `params` lines up
   * positionally with the `$n` placeholders in `where`).
   */
  compile(definition: SegmentDefinition): CompiledSegmentDefinition {
    this.validate(definition);
    const params: unknown[] = [];
    const where = this.compileNode(definition, params, 0);
    return { where, params };
  }

  /**
   * Throws `BadRequestException` if `definition` references an unknown
   * field, uses an operator not allowed for that field, or supplies a
   * value whose type/shape doesn't match the operator (e.g. `between`
   * needs a 2-element array, `in` needs a non-empty array, scalar
   * operators need a scalar).
   */
  validate(definition: SegmentDefinition): void {
    this.validateNode(definition, 0);
  }

  // ---- validation --------------------------------------------------

  private validateNode(definition: SegmentDefinition, depth: number): void {
    if (depth > MAX_DEPTH) {
      throw new BadRequestException('Segment definition nested too deeply');
    }
    if (definition == null || typeof definition !== 'object') {
      throw new BadRequestException('Segment definition node must be an object');
    }
    if (isSegmentBranch(definition)) {
      this.validateBranch(definition, depth);
    } else {
      this.validateLeaf(definition as SegmentLeaf);
    }
  }

  private validateBranch(branch: SegmentBranch, depth: number): void {
    if (branch.op !== 'AND' && branch.op !== 'OR') {
      throw new BadRequestException(`Unknown branch operator: ${String(branch.op)}`);
    }
    if (!Array.isArray(branch.children) || branch.children.length === 0) {
      throw new BadRequestException('Branch nodes require a non-empty "children" array');
    }
    for (const child of branch.children) {
      this.validateNode(child, depth + 1);
    }
  }

  private validateLeaf(leaf: SegmentLeaf): void {
    if (typeof leaf.field !== 'string' || !leaf.field) {
      throw new BadRequestException('Leaf nodes require a "field"');
    }
    // Own-property check: `SEGMENT_FIELDS[leaf.field]` + truthiness would let
    // a key like "__proto__"/"constructor"/"toString" resolve to an
    // Object.prototype member and be mistaken for a real field.
    if (!Object.prototype.hasOwnProperty.call(SEGMENT_FIELDS, leaf.field)) {
      throw new BadRequestException(`Unknown segment field: ${leaf.field}`);
    }
    const field = SEGMENT_FIELDS[leaf.field];
    if (!Object.prototype.hasOwnProperty.call(SQL_OPERATORS, leaf.operator as string)) {
      throw new BadRequestException(`Unknown operator: ${String(leaf.operator)}`);
    }
    if (!field.operators.includes(leaf.operator)) {
      throw new BadRequestException(
        `Operator "${leaf.operator}" is not allowed for field "${leaf.field}"`,
      );
    }
    this.validateValueShape(field, leaf.operator, leaf.value);
  }

  private validateValueShape(field: FieldDef, operator: Operator, value: unknown): void {
    if (operator === 'between') {
      if (!Array.isArray(value) || value.length !== 2) {
        throw new BadRequestException(
          `Field "${field.key}" with operator "between" requires a 2-element array value`,
        );
      }
      value.forEach((v) => this.validateScalar(field, v));
      return;
    }
    if (operator === 'in') {
      if (!Array.isArray(value) || value.length === 0) {
        throw new BadRequestException(
          `Field "${field.key}" with operator "in" requires a non-empty array value`,
        );
      }
      value.forEach((v) => this.validateScalar(field, v));
      return;
    }
    // Scalar operators: <, <=, >, >=, =, !=
    if (Array.isArray(value)) {
      throw new BadRequestException(
        `Field "${field.key}" with operator "${operator}" requires a scalar value, not an array`,
      );
    }
    this.validateScalar(field, value);
  }

  /**
   * Beyond the base JS-type check, validates the value against what the
   * field's `sqlExpr` actually is, so a bad value 400s here instead of
   * reaching Postgres and 500ing (e.g. `invalid input syntax for type uuid`
   * on a non-UUID `manual_user_ids` value, or `invalid input syntax for
   * type integer` on a decimal against `lifetime_order_count`).
   */
  private validateScalar(field: FieldDef, value: unknown): void {
    const type = typeof value;
    if (type !== 'string' && type !== 'number' && type !== 'boolean') {
      throw new BadRequestException(
        `Field "${field.key}" received an unsupported value type: ${type}`,
      );
    }

    // `u.id` is a uuid column — a non-UUID value throws at the DB instead of
    // just matching nobody, so it must be rejected here.
    if (field.key === 'manual_user_ids') {
      if (typeof value !== 'string' || !isUuid(value)) {
        throw new BadRequestException(
          `Field "manual_user_ids" requires UUID values, received: "${String(value)}"`,
        );
      }
      return;
    }

    if (field.valueType === 'number') {
      // `Number('')`/`Number('  ')` is 0, not NaN — an empty/whitespace
      // string would otherwise sail through as a "valid" 0 and then hit
      // Postgres as `invalid input syntax for type numeric: ""` (the value
      // is still bound as the original string, never re-serialized as the
      // coerced number). Reject it before the numeric coercion below.
      if (typeof value === 'string' && value.trim() === '') {
        throw new BadRequestException(
          `Field "${field.key}" requires a numeric value, received: ""`,
        );
      }
      const num = typeof value === 'number' ? value : Number(value);
      // Numeric strings are accepted (stored definitions/API requests may
      // send "1.5"); booleans are rejected even though `Number(true) === 1`
      // is finite — a boolean is never a meaningful threshold.
      if (typeof value === 'boolean' || !Number.isFinite(num)) {
        throw new BadRequestException(
          `Field "${field.key}" requires a numeric value, received: "${String(value)}"`,
        );
      }
      return;
    }

    if (field.key === 'has_company') {
      const isBooleanLike =
        typeof value === 'boolean' || value === 'true' || value === 'false';
      if (!isBooleanLike) {
        throw new BadRequestException(
          `Field "has_company" requires a boolean value, received: "${String(value)}"`,
        );
      }
    }
  }

  // ---- compilation ---------------------------------------------------

  private compileNode(definition: SegmentDefinition, params: unknown[], depth: number): string {
    // Defensive: compile() always validates first (which enforces MAX_DEPTH),
    // but keep the bound here too so the compile walk can never overflow the
    // stack even if compileNode is ever reached without validation.
    if (depth > MAX_DEPTH) {
      throw new BadRequestException('Segment definition nested too deeply');
    }
    if (isSegmentBranch(definition)) {
      return this.compileBranch(definition, params, depth);
    }
    return this.compileLeaf(definition as SegmentLeaf, params);
  }

  private compileBranch(branch: SegmentBranch, params: unknown[], depth: number): string {
    const joiner = branch.op === 'AND' ? ' AND ' : ' OR ';
    const parts = branch.children.map((child) => this.compileNode(child, params, depth + 1));
    return `(${parts.join(joiner)})`;
  }

  private compileLeaf(leaf: SegmentLeaf, params: unknown[]): string {
    // `getField` re-resolves from the same hardcoded registry `validate`
    // already checked against; `field.sqlExpr` is never request-derived.
    const field = getField(leaf.field);

    if (leaf.operator === 'between') {
      const [a, b] = leaf.value as [unknown, unknown];
      const lo = this.pushParam(field, params, a);
      const hi = this.pushParam(field, params, b);
      return `(${field.sqlExpr} BETWEEN ${lo} AND ${hi})`;
    }

    if (leaf.operator === 'in') {
      const values = leaf.value as unknown[];
      const placeholders = values.map((v) => this.pushParam(field, params, v));
      return `(${field.sqlExpr} IN (${placeholders.join(',')}))`;
    }

    const sqlOp = SQL_OPERATORS[leaf.operator];
    const placeholder = this.pushParam(field, params, leaf.value);
    return `(${field.sqlExpr} ${sqlOp} ${placeholder})`;
  }

  /**
   * Pushes a value onto `params` and returns its placeholder. Number fields
   * get an explicit `$n::numeric` cast so a numeric string ("1.5") or a
   * decimal against an integer column (`lifetime_order_count`,
   * `order_count_90d`) compares correctly instead of Postgres throwing
   * `invalid input syntax for type integer` — the cast text is fixed
   * (`field.valueType`, never request-derived), the value stays a bound
   * param, so this doesn't reopen the injection surface `$n` alone closes.
   */
  private pushParam(field: FieldDef, params: unknown[], value: unknown): string {
    params.push(value);
    return field.valueType === 'number' ? `$${params.length}::numeric` : `$${params.length}`;
  }
}
