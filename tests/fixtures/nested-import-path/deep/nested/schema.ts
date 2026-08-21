import * as v from "valibot";
import type { FieldOutput } from "./types";

// Nested two directories deep on purpose: FieldType (common.ts) isn't
// imported here directly, only through types.ts, so TypeScript's printer has
// to synthesize its own import("./common") reference when expanding
// FieldOutput for the explicit v.GenericSchema<FieldOutput> annotation -
// printed relative to this file's directory. Generating to a shallower
// output directory (see the nested-import-path fixtures test in
// extractor.test.ts) is what exposes a path left relative to the wrong base.
export const FieldSchema: v.GenericSchema<FieldOutput> = v.lazy(() =>
  v.object({
    type: v.picklist(["uuid", "string", "number", "boolean"]),
    fields: v.optional(v.record(v.string(), FieldSchema)),
  }),
);
