import * as v from "valibot";
import type { NodeA } from "./node-a";

// NodeA and NodeB (node-a.ts / node-b.ts) refer to each other through
// their own imports - a plain-type cycle that crosses files, not the
// getter-based recursion getter-resolver.ts already handles. Expanding
// this fully is impossible (it would recurse forever); the cycle has to
// be caught and left as a reference at the point it would repeat.
export const CycleSchema: v.GenericSchema<NodeA, NodeA> = v.any();
