import * as v from "valibot";
import { SharedSchema } from "#shared";

export const ExactConsumerSchema = v.object({
  shared: SharedSchema,
  extra: v.boolean(),
});
