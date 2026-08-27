import * as v from "valibot";
import type { Holder } from "./holder";

// Holder is visible here (imported directly), so the printer expands its
// own structure in place - but Foo isn't, so it synthesizes
// import("virtual-lib").Foo directly at the top level, the same synthesis
// path direct-schema.ts's qualified/generic cases exercise (not
// bare-reference promotion through holder.ts's own scope, despite the
// resemblance to that pattern elsewhere in this directory).
export const PackageSpecifierSchema: v.GenericSchema<Holder, Holder> = v.any();
