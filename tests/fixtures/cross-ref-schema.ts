import * as v from "valibot";

export const AddressSchema = v.object({
  street: v.string(),
  city: v.string(),
  country: v.string(),
});

export const UserSchema = v.object({
  name: v.string(),
  address: AddressSchema,
  previousAddresses: v.optional(v.array(AddressSchema)),
});

export const CompanySchema = v.object({
  name: v.string(),
  headquarters: AddressSchema,
  employees: v.array(UserSchema),
});
