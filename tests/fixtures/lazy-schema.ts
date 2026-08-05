import * as v from "valibot";

// ============================================
// Getter-based recursion
// ============================================

// Self-referencing schema using a getter
export const CategorySchema = v.object({
  name: v.string(),
  get subcategories() {
    return v.array(CategorySchema);
  },
});

// Mutually recursive fields using getters
export const TreeNodeSchema = v.object({
  value: v.string(),
  get children() {
    return v.array(TreeNodeSchema);
  },
  get parent() {
    return v.optional(TreeNodeSchema);
  },
});

// v.lazy() for recursive union types
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export const JsonValueSchema: v.GenericSchema<JsonValue> = v.lazy(() =>
  v.union([
    v.string(),
    v.number(),
    v.boolean(),
    v.null(),
    v.array(JsonValueSchema),
    v.record(v.string(), JsonValueSchema),
  ]),
);
