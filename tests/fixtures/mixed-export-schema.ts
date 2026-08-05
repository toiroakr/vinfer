import * as v from "valibot";

// Non-exported helper schema
const InternalMetaSchema = v.object({
  version: v.number(),
  createdAt: v.date(),
});

// Exported schema referencing internal one
export const PublicDataSchema = v.object({
  id: v.string(),
  name: v.string(),
  meta: InternalMetaSchema,
});
