import * as v from "valibot";
import type { Level1 } from "./level1";

// Level1 is declared entirely outside this file, reached through a chain
// of three separate files (level1.ts -> level2.ts -> level3.ts). Only
// Level1 is imported here; Level2 and Level3 are each visible only within
// the file that declares the one below it.
export const ChainSchema: v.GenericSchema<Level1, Level1> = v.any();
