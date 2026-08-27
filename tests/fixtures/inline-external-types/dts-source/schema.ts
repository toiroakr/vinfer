import * as v from "valibot";
import type { Holder } from "./holder";

// Holder isn't visible from schema.ts, so reaching Declared recurses
// through holder.ts's own declaration - where Declared *is* visible.
export const DtsSourceSchema: v.GenericSchema<Holder, Holder> = v.any();
