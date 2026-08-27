import * as v from "valibot";
import type { Holder } from "./holder";

// Holder isn't visible from schema.ts, so reaching Kind recurses through
// holder.ts's own declaration - where Kind *is* visible.
export const ComputedEnumSchema: v.GenericSchema<Holder, Holder> = v.any();
