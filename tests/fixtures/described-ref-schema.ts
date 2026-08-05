import * as v from "valibot";

// Recursive schema with an explicit type annotation, referenced by a union member
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

export const FunctionOperationSchema = v.object({
  kind: v.literal("function"),
  name: v.string(),
});

export const WorkflowOperationSchema = v.object({
  kind: v.literal("workflow"),
  args: v.optional(JsonValueSchema),
});

// A union wrapped in v.description() must keep its named member references
export const OperationSchema = v.pipe(
  v.union([FunctionOperationSchema, WorkflowOperationSchema]),
  v.description("Operation to execute when triggered"),
);

// Field-level v.description() on a schema reference must keep the named reference
export const ExecutorSchema = v.object({
  name: v.string(),
  operation: v.pipe(OperationSchema, v.description("Operation to execute when triggered")),
  fallback: v.pipe(v.optional(WorkflowOperationSchema), v.description("Fallback operation")),
});
