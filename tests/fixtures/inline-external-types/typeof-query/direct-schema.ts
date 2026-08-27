import * as v from "valibot";
import type { Holder } from "./holder";

// Holder is imported directly here, so `typeof Kind` reaches through
// TypeScript's own top-level synthesis (typeof import("./kind").Kind),
// not the bare-reference promotion path wrapper.ts exercises.
export const DirectTypeofQuerySchema: v.GenericSchema<Holder, Holder> = v.any();
