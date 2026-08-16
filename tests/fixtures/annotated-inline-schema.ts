// An explicit `v.GenericSchema<T>` annotation is printed as written, which puts
// the annotation type's own text into the generated file - both the `undefined`
// its optional properties spell out and the modules it names.
import * as v from "valibot";
import type { AnnotatedNodeShape } from "./annotated-inline-types";

// Not exported, so it is inlined into whatever references it.
const InlinedNodeSchema: v.GenericSchema<AnnotatedNodeShape> = v.object({
  kind: v.string(),
  meta: v.object({
    required: v.optional(v.boolean()),
    label: v.optional(v.string()),
  }),
});

export const AnnotatedHolderSchema = v.object({
  node: InlinedNodeSchema,
});

// A string literal is text, not a union: collapsing repeated `| undefined`
// must not reach inside one.
export const LiteralUndefinedSchema = v.object({
  label: v.literal("a | undefined | undefined"),
});

// Exported, so its own declaration keeps the annotation as written - including
// the `import()` type, whose specifier has to resolve from the output file.
export const AnnotatedNodeSchema: v.GenericSchema<AnnotatedNodeShape> = v.object({
  kind: v.string(),
  meta: v.object({
    required: v.optional(v.boolean()),
    label: v.optional(v.string()),
  }),
});
