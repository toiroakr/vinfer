import * as v from "valibot";
import type { Outer } from "./outer";

// Outer isn't visible here, so reaching Middle recurses through outer.ts
// (see nonexported-cycle/outer.ts) - which is where Middle's own
// non-exported, self-referential Hidden field is read from.
export const NonExportedCycleSchema: v.GenericSchema<Outer, Outer> = v.any();
