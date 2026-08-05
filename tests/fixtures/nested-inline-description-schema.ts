import * as v from "valibot";

// Non-exported item schema, reused twice: standalone inside GroupSchema's
// array, and inlined a second time inside ContainerSchema. The inlined
// occurrence's `description` field must keep its own v.description() text, not
// the unrelated top-level `description` field's text from ContainerSchema.
const ItemSchema = v.object({
  flag: v.boolean(),
  description: v.pipe(
    v.optional(v.string()),
    v.description("Item description, distinct from container description"),
  ),
});

export const GroupSchema = v.pipe(
  v.union([v.pipe(v.array(ItemSchema), v.minLength(1), v.readonly()), v.literal("none")]),
  v.description("A group of items, or 'none'"),
);

export const ContainerSchema = v.object({
  name: v.string(),
  description: v.pipe(v.optional(v.string()), v.description("Container-level description")),
  group: v.optional(GroupSchema),
});

// Sibling object members of the same union, inlined side by side. Each
// member's own field description must stay scoped to that member and not
// leak into (or be overwritten by) the sibling parsed just before/after it.
export const SiblingUnionSchema = v.object({
  choice: v.union([
    v.object({ a: v.pipe(v.string(), v.description("A description")) }),
    v.object({ b: v.pipe(v.string(), v.description("B description")) }),
  ]),
});
