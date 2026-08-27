import * as v from "valibot";
import type { Holder } from "./holder";

// Holder isn't visible from schema.ts, so reaching Callback recurses
// through holder.ts's own declaration - where Callback *is* visible.
export const SuffixWrapSchema: v.GenericSchema<Holder, Holder> = v.any();
