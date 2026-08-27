import * as v from "valibot";

declare function randomFlag(): number;

/**
 * Enum with a member whose value isn't a compile-time constant (it comes
 * from a function call), so ts-morph's getMembers()[n].getValue() can't
 * resolve it. Expanding this to a literal union must give up on the whole
 * enum rather than silently drop the unresolvable member, which would print
 * a union narrower than the enum itself. Deliberately not exported: the
 * point of expanding a same-file enum at all is to stand alone without one.
 */
enum Status {
  Active = "active",
  Pending = randomFlag(),
  Closed = "closed",
}

export const StatusSchema = v.enum(Status);
