import * as v from "valibot";
import type { Holder } from "./holder";

// Holder isn't visible from schema.ts, so reaching Foo recurses through
// holder.ts's own declaration - where the bare package specifier
// "virtual-lib" *is* visible, printing as the bare identifier "Foo".
export const PackageSpecifierSchema: v.GenericSchema<Holder, Holder> = v.any();
