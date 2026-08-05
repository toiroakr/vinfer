import * as v from "valibot";

export const AddressSchema = v.object({
  street: v.string(),
  city: v.string(),
});

export const PersonSchema = v.object({
  name: v.string(),
  address: AddressSchema,
  tags: v.array(v.string()),
});
