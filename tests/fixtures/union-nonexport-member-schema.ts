import * as v from "valibot";

// Non-exported member schema (should be inlined in the variant)
const SuccessSchema = v.object({
  status: v.literal("success"),
  data: v.string(),
});

// Non-exported member schema
const ErrorSchema = v.object({
  status: v.literal("error"),
  message: v.string(),
});

// Exported variant referencing non-exported members
export const ResponseSchema = v.variant("status", [SuccessSchema, ErrorSchema]);
