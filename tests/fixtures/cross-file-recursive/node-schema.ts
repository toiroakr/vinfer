// A recursive schema that another file imports. A recursive type has no
// faithful inline form, so a file referencing it has to import the types
// generated from here rather than expand them.
import * as v from "valibot";

export interface CrossFileNodeShape {
  name: string;
  children: Record<string, CrossFileNodeShape>;
}

export const CrossFileNodeSchema = v.object({
  name: v.pipe(v.string(), v.description("The node name")),
  get children(): v.GenericSchema<Record<string, CrossFileNodeShape>> {
    return v.record(v.string(), CrossFileNodeSchema);
  },
});
