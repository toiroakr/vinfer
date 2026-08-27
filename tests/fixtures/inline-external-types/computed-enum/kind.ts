declare function randomFlag(): number;

// B's value isn't a compile-time constant (it comes from a function call),
// so ts-morph's getValue() can't resolve it - printEnumAsLiteralUnion has
// to give up on the whole enum rather than print a union missing B, which
// would silently reject a value TypeScript itself accepts.
export enum Kind {
  A = "a",
  B = randomFlag(),
  C = "c",
}
