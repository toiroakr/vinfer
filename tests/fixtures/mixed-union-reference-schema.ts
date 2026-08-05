import * as v from "valibot";
import { functionSchema } from "./mixed-union-reference-common";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export const JsonValueSchema: v.GenericSchema<JsonValue, JsonValue> = v.lazy(() =>
  v.union([
    v.string(),
    v.number(),
    v.boolean(),
    v.null(),
    v.array(JsonValueSchema),
    v.record(v.string(), JsonValueSchema),
  ]),
);

export const MixedValueSchema = v.pipe(
  v.union([JsonValueSchema, functionSchema]),
  v.description("A JSON value or a function"),
);

const referencedValueEntries = {
  kind: v.literal("reference"),
  value: v.optional(MixedValueSchema),
};

const ValueByReferenceSchema = v.pipe(
  v.object({
    ...referencedValueEntries,
    reference: v.object({ name: v.string() }),
  }),
  v.transform(({ reference, ...entry }) => ({
    ...entry,
    referenceName: reference.name,
  })),
);

const ValueByNameSchema = v.object({
  ...referencedValueEntries,
  referenceName: v.string(),
});

export const ReferencedValueSchema = v.union([ValueByReferenceSchema, ValueByNameSchema]);

export const CallableValueSchema = v.object({
  kind: v.literal("callable"),
  value: functionSchema,
});

export const ValueSchema = v.union([CallableValueSchema, ReferencedValueSchema]);

export const EnvelopeSchema = v.object({
  value: v.pipe(ValueSchema, v.description("Value to store")),
});

const referencedValueOverrideEntries = {
  value: v.optional(MixedValueSchema),
};

const overriddenValueEntries = {
  value: v.optional(v.record(v.string(), v.unknown())),
};

const satisfiedOverrideValueEntries = {
  value: v.optional(v.record(v.string(), v.unknown())),
} satisfies v.ObjectEntries;

export const SpreadOverrideSchema = v.object({
  ...referencedValueOverrideEntries,
  ...overriddenValueEntries,
});

export const SatisfiedSpreadOverrideSchema = v.object({
  ...referencedValueOverrideEntries,
  ...satisfiedOverrideValueEntries,
});

type InternalNode = {
  children: InternalNode[];
};

const InternalNodeSchema: v.GenericSchema<InternalNode, InternalNode> = v.lazy(() =>
  v.object({ children: v.array(InternalNodeSchema) }),
);

export const RecursiveLeafSchema = v.object({
  value: v.string(),
});

export const RecursiveUnionSchema = v.union([InternalNodeSchema, RecursiveLeafSchema]);

const InternalPlainSchema = v.object({
  internal: v.string(),
});

export const PublicPlainSchema = v.object({
  public: v.string(),
});

export const MixedPlainUnionSchema = v.union([InternalPlainSchema, PublicPlainSchema]);

export const InlineImportedUnionSchema = v.union([v.string(), functionSchema]);
