export const NodeSchemaInput = 1;

/**
 * `value` names NodeSchemaInput's own value via `typeof`, not its type, and
 * the method's own name happens to spell out the same text - neither is a
 * reference to whatever a schema literally named `NodeSchema` generates,
 * even though the text matches.
 */
export type Weird = {
  value: typeof NodeSchemaInput;
  NodeSchemaInput(): string;
};
