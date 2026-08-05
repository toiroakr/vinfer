// A namespace import under a non-conventional alias must be recognized too.
import * as valibot from "valibot";

export const AliasedAddressSchema = valibot.object({
  street: valibot.string(),
});

export const AliasedUserSchema = valibot.object({
  name: valibot.string(),
  address: AliasedAddressSchema,
  addresses: valibot.array(AliasedAddressSchema),
});
