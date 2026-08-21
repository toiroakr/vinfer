import type { FieldType } from "./common";

export type FieldOutput = {
  type: FieldType;
  fields?: Record<string, FieldOutput>;
};
