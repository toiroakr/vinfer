import { Node, type SourceFile } from "ts-morph";

/**
 * Module specifiers that are treated as Valibot.
 */
const VALIBOT_MODULES = new Set(["valibot"]);

/**
 * Namespace aliases assumed when a file has no visible Valibot import.
 *
 * Some call sites hand us a source file whose import list is unavailable
 * (synthetic files, partial snippets). Assuming the conventional
 * `import * as v from "valibot"` alias keeps detection working there without
 * loosening it for files that do declare their imports.
 */
const DEFAULT_NAMESPACE_ALIASES = ["v"];

/**
 * Resolves how a source file refers to Valibot's exports.
 *
 * Valibot is used either through a namespace import
 * (`import * as v from "valibot"` - the style its docs recommend) or through
 * named imports (`import { object, string } from "valibot"`). Every AST
 * analyzer needs to recognize both, so the binding resolution lives here.
 */
export class ValibotBindings {
  private static cache = new WeakMap<SourceFile, ValibotBindings>();

  private constructor(
    /** Identifiers bound to the Valibot namespace (e.g. `v`). */
    private readonly namespaceAliases: Set<string>,
    /** Local identifier -> Valibot export name for named imports. */
    private readonly namedImports: Map<string, string>,
  ) {}

  /**
   * Resolves (and caches) the Valibot bindings of a source file.
   */
  static from(sourceFile: SourceFile): ValibotBindings {
    const cached = ValibotBindings.cache.get(sourceFile);
    if (cached) return cached;

    const namespaceAliases = new Set<string>();
    const namedImports = new Map<string, string>();

    for (const importDecl of sourceFile.getImportDeclarations()) {
      if (!VALIBOT_MODULES.has(importDecl.getModuleSpecifierValue())) continue;

      const namespaceImport = importDecl.getNamespaceImport();
      if (namespaceImport) {
        namespaceAliases.add(namespaceImport.getText());
      }

      // `import v from "valibot"` also exposes the whole namespace under esModuleInterop.
      const defaultImport = importDecl.getDefaultImport();
      if (defaultImport) {
        namespaceAliases.add(defaultImport.getText());
      }

      for (const namedImport of importDecl.getNamedImports()) {
        const exportName = namedImport.getName();
        const localName = namedImport.getAliasNode()?.getText() ?? exportName;
        namedImports.set(localName, exportName);
      }
    }

    if (namespaceAliases.size === 0 && namedImports.size === 0) {
      for (const alias of DEFAULT_NAMESPACE_ALIASES) {
        namespaceAliases.add(alias);
      }
    }

    const bindings = new ValibotBindings(namespaceAliases, namedImports);
    ValibotBindings.cache.set(sourceFile, bindings);
    return bindings;
  }

  /**
   * Checks whether an identifier refers to the Valibot namespace.
   */
  isNamespace(identifier: string): boolean {
    return this.namespaceAliases.has(identifier);
  }

  /**
   * Returns the Valibot export name a call expression invokes.
   *
   * Handles both `v.object(...)` (namespace) and `object(...)` (named import).
   * Returns undefined when the callee is not a Valibot export.
   */
  getCallName(node: Node): string | undefined {
    if (!Node.isCallExpression(node)) return undefined;

    const callee = node.getExpression();

    if (Node.isPropertyAccessExpression(callee)) {
      const target = callee.getExpression();
      if (Node.isIdentifier(target) && this.isNamespace(target.getText())) {
        return callee.getName();
      }
      return undefined;
    }

    if (Node.isIdentifier(callee)) {
      return this.namedImports.get(callee.getText());
    }

    return undefined;
  }

  /**
   * Checks whether a node is a call to one of the given Valibot exports.
   */
  isCallTo(node: Node, names: ReadonlySet<string> | string): boolean {
    const callName = this.getCallName(node);
    if (!callName) return false;
    return typeof names === "string" ? callName === names : names.has(callName);
  }

  /**
   * Rewrites Valibot type references in a printed type to their bare names.
   *
   * TypeScript qualifies them by however the analyzed file reaches Valibot -
   * `v.Brand<"UserId">` with a namespace import, `import("valibot").Brand<"UserId">`
   * without one. Generated files declare their own
   * `import type { Brand } from "valibot"`, so both forms are reduced to
   * `Brand<"UserId">`.
   */
  canonicalizeTypeNames(typeText: string): string {
    // Fast path: nothing to rewrite unless a qualified reference is present.
    if (!typeText.includes(".")) return typeText;

    this.canonicalizePattern ??= this.buildCanonicalizePattern();
    return typeText.replace(this.canonicalizePattern, "$1");
  }

  private canonicalizePattern: RegExp | undefined;

  private buildCanonicalizePattern(): RegExp {
    const qualifiers = [
      // `import("…/valibot").Brand<…>` when the file has no namespace import.
      String.raw`import\("[^"]*valibot[^"]*"\)`,
      ...[...this.namespaceAliases].map(escapeRegExp),
    ];
    return new RegExp(
      `(?:${qualifiers.join("|")})\\.(${VALIBOT_PRINTED_TYPE_NAMES.join("|")})\\b`,
      "g",
    );
  }
}

/**
 * Valibot type helpers that can show up in a printed type and therefore need to
 * be imported by generated files.
 */
export const VALIBOT_PRINTED_TYPE_NAMES = ["Brand", "Flavor"] as const;

/**
 * Escapes special characters in a string for use in a RegExp.
 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Valibot exports that produce a schema.
 *
 * Used to decide whether a variable declaration holds a schema, and to tell a
 * schema apart from an action inside `v.pipe(...)`.
 */
export const VALIBOT_SCHEMA_BUILDERS: ReadonlySet<string> = new Set([
  // Primitives and basics
  "any",
  "bigint",
  "blob",
  "boolean",
  "custom",
  "date",
  "enum",
  "enum_",
  "file",
  "function",
  "function_",
  "instance",
  "literal",
  "nan",
  "never",
  "null",
  "null_",
  "number",
  "picklist",
  "string",
  "symbol",
  "undefined",
  "undefined_",
  "unknown",
  "void",
  "void_",
  // Complex
  "array",
  "intersect",
  "lazy",
  "looseObject",
  "looseTuple",
  "map",
  "object",
  "objectWithRest",
  "promise",
  "record",
  "set",
  "strictObject",
  "strictTuple",
  "tuple",
  "tupleWithRest",
  "union",
  "variant",
  // Wrappers
  "exactOptional",
  "nonNullable",
  "nonNullish",
  "nonOptional",
  "nullable",
  "nullish",
  "optional",
  "undefinedable",
  // Methods returning schemas
  "cache",
  "config",
  "fallback",
  "keyof",
  "message",
  "omit",
  "partial",
  "pick",
  "pipe",
  "required",
  "unwrap",
]);

/**
 * Async counterparts of the schema builders (e.g. `objectAsync`).
 */
export const VALIBOT_ASYNC_SCHEMA_BUILDERS: ReadonlySet<string> = new Set(
  [...VALIBOT_SCHEMA_BUILDERS].map((name) => `${name}Async`),
);

/**
 * Every Valibot export that yields a schema, sync or async.
 */
export const VALIBOT_SCHEMA_PRODUCERS: ReadonlySet<string> = new Set([
  ...VALIBOT_SCHEMA_BUILDERS,
  ...VALIBOT_ASYNC_SCHEMA_BUILDERS,
]);

/**
 * Object schema builders whose first argument is the entries object literal.
 */
export const VALIBOT_OBJECT_BUILDERS: ReadonlySet<string> = new Set([
  "object",
  "objectAsync",
  "strictObject",
  "strictObjectAsync",
  "looseObject",
  "looseObjectAsync",
  "objectWithRest",
  "objectWithRestAsync",
]);

/**
 * Wrapper schemas that keep the wrapped schema's shape, only widening it with
 * `undefined` / `null`. A reference wrapped in one of these still points at the
 * same named schema.
 */
export const VALIBOT_OPTIONAL_WRAPPERS: ReadonlySet<string> = new Set([
  "optional",
  "optionalAsync",
  "exactOptional",
  "exactOptionalAsync",
  "nullable",
  "nullableAsync",
  "nullish",
  "nullishAsync",
  "undefinedable",
  "undefinedableAsync",
]);

/**
 * Wrapper schemas that mark the wrapped key optional on an object (the key may
 * be omitted entirely). Per Valibot's own `OptionalEntrySchema` mapped type,
 * `nullable` and `undefinedable` widen the value's type but do not make the key
 * itself optional - only these do.
 */
export const VALIBOT_OPTIONAL_KEY_WRAPPERS: ReadonlySet<string> = new Set([
  "optional",
  "optionalAsync",
  "exactOptional",
  "exactOptionalAsync",
  "nullish",
  "nullishAsync",
]);

/**
 * Wrapper schemas that add `null` to the wrapped value's type.
 */
export const VALIBOT_NULLABLE_WRAPPERS: ReadonlySet<string> = new Set([
  "nullable",
  "nullableAsync",
  "nullish",
  "nullishAsync",
]);

/**
 * Wrapper schemas that add `undefined` to the wrapped value's type without
 * making the key itself optional (unlike `optional` / `nullish`).
 */
export const VALIBOT_UNDEFINEDABLE_WRAPPERS: ReadonlySet<string> = new Set([
  "undefinedable",
  "undefinedableAsync",
]);

/**
 * `v.array(...)` builders.
 */
export const VALIBOT_ARRAY_BUILDERS: ReadonlySet<string> = new Set(["array", "arrayAsync"]);

/**
 * `v.record(...)` builders.
 */
export const VALIBOT_RECORD_BUILDERS: ReadonlySet<string> = new Set(["record", "recordAsync"]);

/**
 * `v.union(...)` builders.
 */
export const VALIBOT_UNION_BUILDERS: ReadonlySet<string> = new Set(["union", "unionAsync"]);

/**
 * `v.variant(...)` builders (Valibot's discriminated union).
 */
export const VALIBOT_VARIANT_BUILDERS: ReadonlySet<string> = new Set(["variant", "variantAsync"]);

/**
 * `v.pipe(...)` builders.
 */
export const VALIBOT_PIPE_BUILDERS: ReadonlySet<string> = new Set(["pipe", "pipeAsync"]);

/**
 * Pipe actions that change the piped type (so a reference behind them is no
 * longer a reference to the original schema).
 */
export const VALIBOT_TYPE_CHANGING_ACTIONS: ReadonlySet<string> = new Set([
  "brand",
  "flavor",
  "readonly",
  "transform",
  "transformAsync",
  "rawTransform",
  "rawTransformAsync",
  "args",
  "argsAsync",
  "returns",
  "returnsAsync",
  "mapItems",
  "filterItems",
  "reduceItems",
  "sortItems",
  "findItem",
  "guard",
  "parseJson",
  "stringifyJson",
  "parseBoolean",
  "toBigint",
  "toBoolean",
  "toDate",
  "toNumber",
  "toString",
]);
