/**
 * Segment definition tree types (Task 5 of the SEGMENTS/TIERS plan).
 *
 * A `SegmentDefinition` is the JSON shape the admin segment builder (Task 6)
 * sends to describe a boolean condition tree over the fields declared in
 * `segment-fields.ts`. It is either a leaf (a single field/operator/value
 * comparison) or a branch (an AND/OR of child definitions, recursively).
 *
 * `SegmentDefinitionCompiler` (see `segment-definition.compiler.ts`) is the
 * only place that turns this tree into SQL; this file only declares the
 * shape so the controller/DTO layer (Task 6) and the compiler agree on it.
 *
 * class-validator decorators are intentionally omitted here — semantic
 * validation (unknown field, disallowed operator, value shape) is owned by
 * `SegmentDefinitionCompiler.validate`, which has access to the field
 * registry and can give precise, field-aware error messages. Adding
 * class-validator decorators on top would duplicate that logic without
 * being able to express "value shape depends on which field/operator was
 * chosen".
 */

import { Operator } from '../segment-fields';

export type SegmentLeafValue = string | number | boolean | Array<string | number>;

export type SegmentLeaf = {
  field: string;
  operator: Operator;
  value: SegmentLeafValue;
};

export type SegmentBranchOp = 'AND' | 'OR';

export type SegmentBranch = {
  op: SegmentBranchOp;
  children: SegmentDefinition[];
};

export type SegmentDefinition = SegmentLeaf | SegmentBranch;

export function isSegmentBranch(def: SegmentDefinition): def is SegmentBranch {
  return (def as SegmentBranch).op !== undefined && Array.isArray((def as SegmentBranch).children);
}

export function isSegmentLeaf(def: SegmentDefinition): def is SegmentLeaf {
  return !isSegmentBranch(def);
}
