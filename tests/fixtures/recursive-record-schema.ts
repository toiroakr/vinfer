// Self-referencing schemas whose getter carries an explicit return type. The
// annotation lets TypeScript unfold one full copy of the schema before it hits
// the recursion, so these fixtures pin down that the copy is collapsed into a
// plain self-reference - and that every level keeps its `v.description()`.
import * as v from "valibot";

export interface RecursiveRecordShape {
  name: string;
  children: Record<string, RecursiveRecordShape>;
}

/**
 * Self-reference under a required key.
 */
export const RecursiveRecordSchema = v.object({
  name: v.pipe(v.string(), v.description("The node name")),
  get children(): v.GenericSchema<Record<string, RecursiveRecordShape>> {
    return v.record(v.string(), RecursiveRecordSchema);
  },
});

export interface OptionalRecursiveRecordShape {
  name: string;
  children?: Record<string, OptionalRecursiveRecordShape>;
}

/**
 * Self-reference under an optional key, annotated.
 */
export const OptionalRecursiveRecordSchema = v.object({
  name: v.pipe(v.string(), v.description("The optional node name")),
  get children(): v.OptionalSchema<
    v.GenericSchema<Record<string, OptionalRecursiveRecordShape>>,
    undefined
  > {
    return v.optional(v.record(v.string(), OptionalRecursiveRecordSchema));
  },
});

/**
 * Self-reference under an optional key, left for vinfer to reconstruct from the
 * getter's AST.
 */
export const InferredOptionalRecordSchema = v.object({
  name: v.pipe(v.string(), v.description("The inferred node name")),
  get children() {
    return v.optional(v.record(v.string(), InferredOptionalRecordSchema));
  },
});

export interface RecursiveArrayShape {
  name: string;
  children: RecursiveArrayShape[];
}

/**
 * Self-reference through an array rather than a record.
 */
export const RecursiveArraySchema = v.object({
  name: v.pipe(v.string(), v.description("The array node name")),
  get children(): v.GenericSchema<RecursiveArrayShape[]> {
    return v.array(RecursiveArraySchema);
  },
});

const LeafSchema = v.object({
  label: v.pipe(v.string(), v.description("The leaf label")),
});

/**
 * A non-exported schema behind an index signature is inlined, and its field
 * descriptions have to survive that inlining.
 */
export const LeafRecordSchema = v.object({
  leaves: v.record(v.string(), LeafSchema),
});
