import type { Level3, Formatter } from "./level3";

// Level3 and Formatter are visible here (imported into this file), so when
// schema.ts recurses into Level2's own declaration, TypeScript prints
// these fields as the bare identifiers "Level3"/"Formatter" - correct only
// from within this file's own scope. Once that text is read out and
// embedded into schema.ts's generated output, either bare name would be a
// dangling reference; the --inline-external-types feature has to promote
// them to an explicit, resolvable form before embedding.
export type Level2 = {
  name: string;
  deep: Level3;
  format: Formatter;
};
