/**
 * Normalize type definition for expanding utility types, intersections, and conditional types.
 *
 * This type template is injected in-memory to expand complex type structures
 * into their fully evaluated form.
 *
 * Built-in types like Date, Array, Map, Set, Promise, Function, etc. are preserved without expansion.
 * Symbol-keyed properties are filtered out from object types. Variadic tuples
 * (`[string, ...number[]]`, from `v.tupleWithRest()`) keep their shape instead of
 * collapsing into a plain array.
 *
 * Primitives are returned untouched rather than widened, which keeps Valibot's
 * branded and flavored primitives (`string & Brand<"UserId">`) intact wherever
 * they appear - including inside arrays, records, and unions. Their printed form
 * is canonicalized afterwards (see `canonicalizeValibotTypeNames`).
 */
export const NORMALIZE_TYPE_DEFINITION = `
type __Normalize<T> =
  T extends Date | RegExp | Error | Map<any, any> | Set<any> | WeakMap<any, any> | WeakSet<any> | Promise<any> | Function
    ? T
    : T extends (...args: infer A) => infer R
      ? (...args: __Normalize<A>) => __Normalize<R>
      : T extends readonly any[]
        ? number extends T['length']
          ? T extends readonly [any, ...any[]]
            ? T extends [any, ...any[]]
              ? __NormalizeTuple<T>
              : Readonly<__NormalizeTuple<T>>
            : T extends (infer U)[]
              ? __Normalize<U>[]
              : readonly __Normalize<T[number]>[]
          : { [K in keyof T]: __Normalize<T[K]> }
        : T extends string | number | boolean | bigint | symbol
          ? T
          : T extends object
            ? T extends infer O
              ? { [K in keyof O as K extends symbol ? never : K]: __Normalize<O[K]> }
              : never
            : T;

type __NormalizeTuple<T> =
  T extends readonly [infer H, ...infer R]
    ? [__Normalize<H>, ...__NormalizeTuple<R>]
    : T extends readonly (infer U)[]
      ? __Normalize<U>[]
      : [];
`;

/**
 * Names of the type aliases `NORMALIZE_TYPE_DEFINITION` declares, so callers can
 * inject and clean them up as a unit.
 */
export const NORMALIZE_TYPE_NAMES = ["__Normalize", "__NormalizeTuple"] as const;

/**
 * Creates a temporary type alias for extracting input or output type from a Valibot schema.
 *
 * The schema's input/output types are read straight off its internal `~types`
 * property - exactly how `v.InferInput` / `v.InferOutput` are defined. Going
 * through `~types` instead of those helpers means no `valibot` import has to be
 * injected into the analyzed file, so extraction works no matter how (or
 * whether) the file imports Valibot.
 *
 * @param schemaName - The name of the exported Valibot schema (e.g., "UserSchema")
 * @param typeKind - Either 'input' or 'output' to specify which type to extract
 * @returns A TypeScript type alias string to be injected in-memory
 */
export function createTempTypeAlias(schemaName: string, typeKind: "input" | "output"): string {
  const typeName = typeKind === "input" ? "__TempInput" : "__TempOutput";
  return `type ${typeName} = __Normalize<NonNullable<(typeof ${schemaName})["~types"]>["${typeKind}"]>;`;
}
