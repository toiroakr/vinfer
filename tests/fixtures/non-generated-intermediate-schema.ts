// References that pass through schemas vinfer generates no types for. The
// intermediate has to be inlined, but the references it makes to schemas that
// *are* generated must survive being nested inside it.
import * as v from "valibot";

export interface IntermediateNodeShape {
  name: string;
  children: Record<string, IntermediateNodeShape>;
}

export const IntermediateNodeSchema = v.object({
  name: v.pipe(v.string(), v.description("The node name")),
  get children(): v.GenericSchema<Record<string, IntermediateNodeShape>> {
    return v.record(v.string(), IntermediateNodeSchema);
  },
});

// Not exported, so no type is generated for it.
const GroupSchema = v.object({
  members: v.array(IntermediateNodeSchema),
  byKey: v.record(v.string(), IntermediateNodeSchema),
  lead: v.optional(IntermediateNodeSchema),
});

// A second non-generated level on top of the first.
const DepartmentSchema = v.object({
  group: v.pipe(GroupSchema, v.description("The group")),
});

// Recursive and not exported: nothing will declare a name for it, so a
// reference to it can only be an approximation.
interface LocalRecursiveShape {
  label: string;
  kids: Record<string, LocalRecursiveShape>;
}

const LocalRecursiveSchema = v.object({
  label: v.pipe(v.string(), v.description("The local label")),
  get kids(): v.GenericSchema<Record<string, LocalRecursiveShape>> {
    return v.record(v.string(), LocalRecursiveSchema);
  },
});

export const OrganizationSchema = v.object({
  direct: v.pipe(IntermediateNodeSchema, v.description("Depth 1: direct reference")),
  viaGroup: v.pipe(GroupSchema, v.description("Depth 2: through a non-generated schema")),
  viaDepartment: v.pipe(DepartmentSchema, v.description("Depth 3: through two of them")),
  localRecursive: v.pipe(LocalRecursiveSchema, v.description("Non-exported recursive")),
});
