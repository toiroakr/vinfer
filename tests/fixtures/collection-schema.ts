import * as v from "valibot";

export const EntrySchema = v.object({
  id: v.string(),
  label: v.string(),
});

export const CollectionSchema = v.object({
  byId: v.record(v.string(), EntrySchema),
  labels: v.map(v.string(), v.number()),
  ids: v.set(v.string()),
  matrix: v.array(v.array(v.number())),
  timestamps: v.array(v.date()),
});
