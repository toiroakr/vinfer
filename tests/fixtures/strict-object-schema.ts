import * as v from "valibot";

export const AddressSchema = v.strictObject({
  street: v.string(),
  city: v.string(),
});

export const UserSchema = v.strictObject({
  name: v.string(),
  address: AddressSchema,
  previousAddresses: v.optional(v.array(AddressSchema)),
});

export const LooseProfileSchema = v.looseObject({
  address: AddressSchema,
});

export const ObjectWithRestSchema = v.objectWithRest({ address: AddressSchema }, v.unknown());
