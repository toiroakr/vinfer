import * as v from "valibot";
import { SharedSchema } from "#/shared.js";

export const DescribedConsumerSchema = v.object({
  shared: SharedSchema,
  name: v.pipe(v.string(), v.description("The user's name")),
});
