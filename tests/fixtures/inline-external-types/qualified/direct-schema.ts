import * as v from "valibot";
import type { Holder } from "./holder";

// Holder is imported directly here, so TypeScript's printer synthesizes
// import("kind").Kind.A / import("kind").Box<string> for Kind and Box
// (invisible from this file) at the top level, in the raw text
// resolveType() reads directly - not through a recursed-into file's own
// declaration like qualified/schema.ts (via wrapper.ts) exercises.
export const DirectQualifiedSchema: v.GenericSchema<Holder, Holder> = v.any();
