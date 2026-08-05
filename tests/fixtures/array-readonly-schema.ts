import * as v from "valibot";

// Regular arrays should NOT have readonly modifier
export const ListSchema = v.object({
  items: v.array(v.string()),
  nested: v.array(v.array(v.number())),
});

// v.readonly() marks the output as readonly, the input stays mutable
export const FrozenListSchema = v.object({
  items: v.pipe(v.array(v.string()), v.readonly()),
});
