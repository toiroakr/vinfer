import type { NodeA } from "./node-a";

// NodeA is visible here (imported for this file's own use), so expanding
// NodeB's own declaration prints this field as the bare identifier
// "NodeA" - the same promotion concern as chain/level2.ts's "Level3", but
// this time the promoted reference cycles back to the type currently
// being expanded (NodeA, from cycle/schema.ts), rather than reaching a
// leaf.
export type NodeB = {
  value: string;
  prev?: NodeA;
};
