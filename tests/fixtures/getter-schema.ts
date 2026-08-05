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

// Schema with v.custom<Function>
const functionSchema = v.custom<Function>((val) => typeof val === "function");

export const CallbackSchema = v.object({
  name: v.string(),
  callback: functionSchema,
  optionalCallback: v.optional(functionSchema),
});
