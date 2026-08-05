import * as v from "valibot";

// Tuple types should be preserved, not expanded into arrays
export const PointSchema = v.object({
  coordinates: v.tuple([v.number(), v.number()]),
  label: v.string(),
});

export const MixedTupleSchema = v.object({
  entry: v.tuple([v.string(), v.number(), v.boolean()]),
});

export const TupleWithRestSchema = v.object({
  entry: v.tupleWithRest([v.string()], v.number()),
});
