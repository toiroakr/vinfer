import * as v from "valibot";

// Getter-based recursive schema (self-referencing)
export const TreeNodeSchema = v.object({
  value: v.string(),
  get children() {
    return v.optional(v.array(TreeNodeSchema));
  },
});

// Getter-based recursive schema with a record
export const NestedRecordSchema = v.object({
  name: v.string(),
  get items() {
    return v.record(v.string(), NestedRecordSchema);
  },
});

// Getter-based recursive schema, nullable only: the key stays required, the
// value's type gains `| null`. Unlike v.optional(), v.nullable() does not mark
// the object key itself optional.
export const NullableTreeSchema = v.object({
  value: v.string(),
  get children() {
    return v.nullable(v.array(NullableTreeSchema));
  },
});

// Getter-based recursive schema, nullish: both the key is optional and the
// value's type gains `| null`.
export const NullishTreeSchema = v.object({
  value: v.string(),
  get children() {
    return v.nullish(v.array(NullishTreeSchema));
  },
});

// Getter-based recursive schema, explicit v.optional(v.nullable(...)) chain:
// same effect as v.nullish() but composed from two separate wrappers.
export const NullableOptionalTreeSchema = v.object({
  value: v.string(),
  get children() {
    return v.optional(v.nullable(v.array(NullableOptionalTreeSchema)));
  },
});

// Getter-based recursive schema, undefinedable: the key stays required (unlike
// v.optional()), but the value's type gains `| undefined`.
export const UndefinedableTreeSchema = v.object({
  value: v.string(),
  get children() {
    return v.undefinedable(v.array(UndefinedableTreeSchema));
  },
});

// Schema with v.custom<Function>
const functionSchema = v.custom<Function>((val) => typeof val === "function");

export const CallbackSchema = v.object({
  name: v.string(),
  callback: functionSchema,
  optionalCallback: v.optional(functionSchema),
});
