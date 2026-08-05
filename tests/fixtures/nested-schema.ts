import * as v from "valibot";

/**
 * Nested schema to verify deep object expansion.
 */
const AddressSchema = v.object({
  street: v.string(),
  city: v.string(),
  zipCode: v.string(),
});

export const PersonSchema = v.object({
  name: v.string(),
  address: AddressSchema,
  alternateAddresses: v.array(AddressSchema),
});
