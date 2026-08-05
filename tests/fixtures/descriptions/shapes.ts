import * as v from "valibot";

/**
 * Every shape `DescriptionExtractor` has to walk through.
 *
 * Kept out of `tests/fixtures/*.ts` so it is not swept up by the snapshot and
 * type-test generation, which target type extraction rather than descriptions.
 */
const SharedSchema = v.object({
  label: v.pipe(v.string(), v.description("A shared label")),
});

export const ShapesSchema = v.pipe(
  v.object({
    // Description directly on a piped primitive
    plain: v.pipe(v.string(), v.description("A plain string")),

    // Description inside the wrapper, and outside it
    optionalInner: v.optional(v.pipe(v.string(), v.description("Optional, described inside"))),
    optionalOuter: v.pipe(v.optional(v.string()), v.description("Optional, described outside")),
    nullable: v.nullable(v.pipe(v.string(), v.description("Nullable"))),

    // Nested object entries extend the path
    nested: v.object({
      inner: v.pipe(v.number(), v.description("A nested number")),
    }),

    // Arrays, unions, records and tuples print inline, so their members'
    // descriptions belong to the same path as the field holding them
    items: v.array(
      v.object({
        itemField: v.pipe(v.string(), v.description("An item field")),
      }),
    ),
    choice: v.union([
      v.object({ a: v.pipe(v.string(), v.description("Choice A")) }),
      v.object({ b: v.pipe(v.string(), v.description("Choice B")) }),
    ]),
    tagged: v.variant("kind", [
      v.object({
        kind: v.literal("one"),
        one: v.pipe(v.string(), v.description("Variant one")),
      }),
    ]),
    lookup: v.record(
      v.string(),
      v.object({ value: v.pipe(v.string(), v.description("A record value")) }),
    ),
    pair: v.tuple([v.object({ first: v.pipe(v.string(), v.description("Tuple member")) })]),

    // v.metadata() is an alternative spelling
    viaMetadata: v.pipe(v.string(), v.metadata({ description: "Described via metadata" })),

    // v.title() is not a description
    titled: v.pipe(v.string(), v.title("Just a title")),

    // The last description in a pipe wins, and a nested pipe is the fallback
    overridden: v.pipe(
      v.string(),
      v.description("First"),
      v.minLength(1),
      v.description("Last wins"),
    ),
    fromNestedPipe: v.pipe(v.pipe(v.string(), v.description("From the nested pipe")), v.trim()),

    // The same schema reused at two paths must be described at both
    firstUse: SharedSchema,
    secondUse: SharedSchema,

    // No description at all
    bare: v.boolean(),
  }),
  v.description("Every description shape"),
);

export type Tree = {
  name: string;
  children: Tree[];
};

/**
 * A recursive schema: walking it must terminate.
 */
export const TreeSchema: v.GenericSchema<Tree> = v.lazy(() =>
  v.object({
    name: v.pipe(v.string(), v.description("The node name")),
    children: v.array(TreeSchema),
  }),
);

/**
 * A schema with no descriptions anywhere.
 */
export const UndescribedSchema = v.object({
  value: v.string(),
});
