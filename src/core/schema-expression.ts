import { Node } from "ts-morph";
import {
  ValibotBindings,
  VALIBOT_ARRAY_BUILDERS,
  VALIBOT_NULLABLE_WRAPPERS,
  VALIBOT_OPTIONAL_KEY_WRAPPERS,
  VALIBOT_OPTIONAL_WRAPPERS,
  VALIBOT_PIPE_BUILDERS,
  VALIBOT_RECORD_BUILDERS,
  VALIBOT_SCHEMA_PRODUCERS,
  VALIBOT_TYPE_CHANGING_ACTIONS,
  VALIBOT_UNDEFINEDABLE_WRAPPERS,
} from "./valibot-bindings.js";

/**
 * A reference from one schema expression to a named schema.
 */
export interface SchemaExpressionRef {
  /** The referenced schema name */
  refSchema: string;
  /** Whether the reference is wrapped in `v.array()` */
  isArray: boolean;
  /** Whether the reference is the value schema of a `v.record()` */
  isRecord: boolean;
  /**
   * Whether the reference's key may be omitted entirely (`v.optional()` /
   * `v.exactOptional()` / `v.nullish()`). Distinct from `isNullable`: Valibot's
   * `v.nullable()` and `v.undefinedable()` widen the value's type without
   * making the key itself optional.
   */
  isOptional: boolean;
  /** Whether the reference's value type includes `null` (`v.nullable()` / `v.nullish()`) */
  isNullable: boolean;
  /** Whether the reference's value type includes `undefined` without the key being optional (`v.undefinedable()`) */
  isUndefinedable: boolean;
}

/**
 * Strips wrappers that do not change which expression is evaluated
 * (`as`, `satisfies`, parentheses, type assertions).
 */
export function unwrapExpression(node: Node): Node {
  let current = node;
  while (
    Node.isAsExpression(current) ||
    Node.isSatisfiesExpression(current) ||
    Node.isParenthesizedExpression(current) ||
    Node.isTypeAssertion(current)
  ) {
    current = current.getExpression();
  }
  return current;
}

/**
 * Resolves which named schema a schema expression ultimately points at.
 *
 * Valibot composes schemas by wrapping them in function calls rather than by
 * chaining methods, so the wrappers are peeled off one call at a time:
 * `v.optional(v.array(AddressSchema))` resolves to `AddressSchema` as an
 * optional array.
 *
 * Returns null when the expression is not (a wrapper around) a reference to a
 * schema accepted by `isCandidateRef` - including when a `v.pipe()` action
 * changes the type, since the result is then no longer that schema's type.
 *
 * @param node - The expression to analyze
 * @param bindings - How the analyzed file refers to Valibot's exports
 * @param isCandidateRef - Predicate selecting the identifiers that count as references
 */
export function analyzeSchemaExpression(
  node: Node,
  bindings: ValibotBindings,
  isCandidateRef: (name: string) => boolean,
): SchemaExpressionRef | null {
  let isArray = false;
  let isRecord = false;
  let isOptional = false;
  let isNullable = false;
  let isUndefinedable = false;
  let current = unwrapExpression(node);

  for (;;) {
    if (Node.isIdentifier(current)) {
      const name = current.getText();
      if (!isCandidateRef(name)) return null;
      return { refSchema: name, isArray, isRecord, isOptional, isNullable, isUndefinedable };
    }

    if (!Node.isCallExpression(current)) return null;

    const callName = bindings.getCallName(current);
    if (!callName) return null;

    const args = current.getArguments();

    if (VALIBOT_OPTIONAL_WRAPPERS.has(callName)) {
      if (args.length === 0) return null;
      if (VALIBOT_OPTIONAL_KEY_WRAPPERS.has(callName)) isOptional = true;
      if (VALIBOT_NULLABLE_WRAPPERS.has(callName)) isNullable = true;
      if (VALIBOT_UNDEFINEDABLE_WRAPPERS.has(callName)) isUndefinedable = true;
      current = unwrapExpression(args[0]);
      continue;
    }

    if (VALIBOT_PIPE_BUILDERS.has(callName)) {
      if (args.length === 0) return null;
      // A pipe only preserves the reference while every action after the first
      // item leaves the type alone (validations, metadata, ...).
      if (!args.slice(1).every((action) => isTypePreservingAction(action, bindings))) {
        return null;
      }
      current = unwrapExpression(args[0]);
      continue;
    }

    if (VALIBOT_ARRAY_BUILDERS.has(callName)) {
      // Nested collections (array of arrays, array of records) have no place to
      // put the named reference, so leave them inlined.
      if (args.length === 0 || isArray || isRecord) return null;
      isArray = true;
      current = unwrapExpression(args[0]);
      continue;
    }

    if (VALIBOT_RECORD_BUILDERS.has(callName)) {
      if (args.length < 2 || isArray || isRecord) return null;
      isRecord = true;
      current = unwrapExpression(args[1]);
      continue;
    }

    return null;
  }
}

/**
 * Checks whether a `v.pipe()` item is an action that keeps the piped type as is.
 */
function isTypePreservingAction(node: Node, bindings: ValibotBindings): boolean {
  const callName = bindings.getCallName(unwrapExpression(node));
  if (!callName) return false;
  return !VALIBOT_SCHEMA_PRODUCERS.has(callName) && !VALIBOT_TYPE_CHANGING_ACTIONS.has(callName);
}
