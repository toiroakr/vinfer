import * as v from "valibot";
import { CrossFileNodeSchema } from "./node-schema";

// Not exported, so no type is generated for it: it has to be inlined, without
// losing the reference to the imported schema it holds.
const CrossFileGroupSchema = v.object({
  members: v.array(CrossFileNodeSchema),
});

export const CrossFileTreeSchema = v.object({
  root: v.pipe(CrossFileNodeSchema, v.description("Root node")),
  index: v.record(v.string(), CrossFileNodeSchema),
  group: v.pipe(CrossFileGroupSchema, v.description("Through a non-generated schema")),
});
