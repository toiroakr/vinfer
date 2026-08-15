import * as v from "valibot";
import { CrossFileNodeSchema } from "./node-schema";

export const CrossFileTreeSchema = v.object({
  root: v.pipe(CrossFileNodeSchema, v.description("Root node")),
  index: v.record(v.string(), CrossFileNodeSchema),
});
