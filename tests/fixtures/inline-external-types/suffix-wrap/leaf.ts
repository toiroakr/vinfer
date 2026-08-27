// A plain (non-generic) function type alias. Unlike a conditional type over
// a concrete operand - which the checker reduces to its result before this
// is ever printed, so it can never survive as literal conditional syntax
// through a bare-name reference - a function type alias prints exactly as
// declared, with no equivalent reduction.
export type Callback = (value: string) => string;
