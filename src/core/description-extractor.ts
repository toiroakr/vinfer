import { existsSync, readFileSync } from "fs";
import { dirname, join, resolve } from "pathe";
import { createJiti, type Jiti } from "jiti";
import { logDebugError, logVerbose } from "./logger.js";
import type { FieldDescription } from "./types.js";

/**
 * Schema description information.
 */
export interface SchemaDescription {
  /** Schema name */
  schemaName: string;
  /** Schema-level description if present */
  description?: string;
  /** Field descriptions */
  fields: FieldDescription[];
}

/**
 * Options for the DescriptionExtractor.
 */
export interface DescriptionExtractorOptions {
  /** Path to tsconfig.json for resolving path aliases */
  tsconfigPath?: string;
}

/**
 * Extracts descriptions from Valibot schemas by dynamically importing the module.
 *
 * Valibot stores `v.description()` as a metadata action inside `v.pipe()`, so the
 * descriptions only exist on the built schema objects - not in a form the type
 * checker can hand us. The module is therefore imported (through jiti, for
 * TypeScript-aware resolution of extensionless imports and path aliases) and the
 * resulting schemas are walked at runtime.
 */
export class DescriptionExtractor {
  private tsconfigAliases: Record<string, string>;
  /** jiti instances keyed by the nearest package.json path (so each module's subpath imports resolve correctly). */
  private jitiCache = new Map<string, Jiti>();

  constructor(options?: DescriptionExtractorOptions) {
    this.tsconfigAliases = options?.tsconfigPath ? this.loadPathAliases(options.tsconfigPath) : {};
  }

  /**
   * Returns a jiti instance configured to resolve the module at `filePath`.
   *
   * Node only resolves the bare "#/" subpath import form (e.g.
   * "#/schemas/user.js") natively from Node 26 onward; older Node rejects it as
   * an invalid internal imports specifier. jiti delegates subpath-imports
   * resolution to the running Node, so on Node < 26 it cannot import modules
   * that rely on a package.json `imports` `#/*` mapping. We bridge this by
   * reading the nearest package.json `imports` field and registering jiti
   * aliases for it (the same mechanism we already use for tsconfig `paths`),
   * which makes resolution work regardless of the Node version.
   */
  private getJiti(filePath: string): Jiti {
    const packageJsonPath = this.findNearestPackageJson(filePath);
    const cacheKey = packageJsonPath ?? "";

    const cached = this.jitiCache.get(cacheKey);
    if (cached) return cached;

    const importAliases = packageJsonPath ? this.loadSubpathImports(packageJsonPath) : {};
    const alias = { ...this.tsconfigAliases, ...importAliases };

    const jiti = createJiti(import.meta.url, {
      ...(Object.keys(alias).length ? { alias } : {}),
      interopDefault: false,
    });

    this.jitiCache.set(cacheKey, jiti);
    return jiti;
  }

  /**
   * Walks up from a file to find the nearest package.json.
   */
  private findNearestPackageJson(filePath: string): string | undefined {
    let dir = dirname(resolve(filePath));

    while (true) {
      const candidate = join(dir, "package.json");
      if (existsSync(candidate)) {
        return candidate;
      }
      const parent = dirname(dir);
      if (parent === dir) {
        return undefined;
      }
      dir = parent;
    }
  }

  /**
   * Loads subpath import aliases from a package.json `imports` field.
   *
   * Wildcard keys keep their trailing "/" (e.g. "#/*" -> "#/", "#src/*" ->
   * "#src/") so that prefix matching never collides with unrelated keys such as
   * an exact "#shared" import.
   */
  private loadSubpathImports(packageJsonPath: string): Record<string, string> {
    try {
      const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
      const imports = pkg?.imports;
      if (!imports || typeof imports !== "object") return {};

      const packageDir = dirname(packageJsonPath);
      const aliases: Record<string, string> = {};

      for (const [key, value] of Object.entries(imports)) {
        const target = this.resolveImportTarget(value);
        if (!target) continue;

        if (key.endsWith("*")) {
          // Wildcard mapping: drop the trailing "*" but keep the "/" so the
          // alias matches "#/..." / "#src/..." without matching "#shared".
          const aliasKey = key.slice(0, -1);
          // Strip "*" and any suffix after it (e.g. "./src/*.ts" -> "./src/"):
          // jiti resolves the extension itself, so only the prefix directory
          // is needed. A bare trailing "*" ("./schemas/*") is handled too.
          let aliasValue = resolve(packageDir, target.replace(/\*.*$/, ""));
          if (aliasKey.endsWith("/") && !aliasValue.endsWith("/")) {
            aliasValue += "/";
          }
          aliases[aliasKey] = aliasValue;
        } else {
          aliases[key] = resolve(packageDir, target);
        }
      }

      logVerbose(`Loaded subpath imports from ${packageJsonPath}: ${JSON.stringify(aliases)}`);
      return aliases;
    } catch (error) {
      logDebugError(`Failed to load subpath imports from ${packageJsonPath}`, error);
      return {};
    }
  }

  /**
   * Resolves a package.json `imports` target to a file path string.
   * Targets may be a plain string or a conditional object.
   */
  private resolveImportTarget(value: unknown): string | undefined {
    if (typeof value === "string") return value;
    if (value && typeof value === "object") {
      const conditions = value as Record<string, unknown>;
      for (const condition of ["import", "node", "default", "require"]) {
        const resolved = this.resolveImportTarget(conditions[condition]);
        if (resolved) return resolved;
      }
    }
    return undefined;
  }

  /**
   * Loads path aliases from tsconfig.json for module resolution.
   */
  private loadPathAliases(tsconfigPath: string): Record<string, string> {
    try {
      const tsconfig = JSON.parse(readFileSync(tsconfigPath, "utf-8"));
      const paths = tsconfig?.compilerOptions?.paths;
      const baseUrl = tsconfig?.compilerOptions?.baseUrl || ".";
      const basePath = resolve(tsconfigPath, "..", baseUrl);

      if (!paths) return {};

      const aliases: Record<string, string> = {};
      for (const [key, values] of Object.entries(paths)) {
        const targetValues = values as string[];
        if (targetValues.length > 0) {
          // Convert "key/*" → "key" and "value/*" → "basePath/value"
          const aliasKey = key.replace(/\/\*$/, "");
          const aliasValue = resolve(basePath, targetValues[0].replace(/\/\*$/, ""));
          aliases[aliasKey] = aliasValue;
        }
      }

      logVerbose(`Loaded path aliases from ${tsconfigPath}: ${JSON.stringify(aliases)}`);
      return aliases;
    } catch (error) {
      logDebugError(`Failed to load tsconfig paths from ${tsconfigPath}`, error);
      return {};
    }
  }

  /**
   * Extracts descriptions from schemas in a file.
   *
   * @param filePath - Path to the TypeScript/JavaScript file
   * @param schemaNames - Names of schemas to extract descriptions from
   * @returns Map of schema name to description info
   */
  async extractDescriptions(
    filePath: string,
    schemaNames: string[],
  ): Promise<Map<string, SchemaDescription>> {
    const result = new Map<string, SchemaDescription>();

    try {
      const absolutePath = resolve(filePath);

      // Use jiti for TypeScript-aware module resolution
      const module = await this.getJiti(absolutePath).import(absolutePath);

      const moduleObj = module as Record<string, unknown>;

      for (const schemaName of schemaNames) {
        const schema = moduleObj[schemaName];
        if (!schema) {
          continue;
        }

        try {
          result.set(schemaName, this.extractFromSchema(schema, schemaName));
        } catch (error) {
          // One unwalkable schema must not cost the whole file its descriptions.
          console.warn(
            `Warning: Could not read descriptions from "${schemaName}" in ${filePath}:`,
            (error as Error).message,
          );
        }
      }
    } catch (error) {
      // If import fails, return empty descriptions (non-blocking)
      console.warn(
        `Warning: Could not import ${filePath} for description extraction:`,
        (error as Error).message,
      );
    }

    return result;
  }

  /**
   * Extracts descriptions from a Valibot schema.
   */
  private extractFromSchema(schema: unknown, schemaName: string): SchemaDescription {
    const fields: FieldDescription[] = [];

    this.extractFieldDescriptions(schema, "", fields, new Set());

    return {
      schemaName,
      description: this.getDescription(schema),
      fields,
    };
  }

  /**
   * Recursively extracts field descriptions from a Valibot schema.
   *
   * Arrays, unions, records and the like are printed inline (no index/branch
   * segment), so their element/member schemas are recursed into at the *same*
   * path as the field that holds them - only object entries extend the path.
   *
   * @param activeSchemas - Schemas on the current recursion path, so recursive
   *   schemas terminate. Entries are removed on the way out, which keeps a schema
   *   reused at several paths described at each of them.
   */
  private extractFieldDescriptions(
    schema: unknown,
    prefix: string,
    fields: FieldDescription[],
    activeSchemas: Set<object>,
  ): void {
    if (!isPlainObject(schema) || activeSchemas.has(schema)) return;

    // Both the schema as received and the one that shapes its value are marked
    // active: `v.lazy()` builds a fresh schema on every call, so only the lazy
    // wrapper itself is a stable identity to detect recursion by.
    const entered: object[] = [schema];
    activeSchemas.add(schema);

    const structural = this.resolveStructuralSchema(schema);
    if (structural && !activeSchemas.has(structural)) {
      activeSchemas.add(structural);
      entered.push(structural);
    }

    try {
      if (!structural) return;

      const entries = this.getEntries(structural);
      if (entries) {
        for (const [key, fieldSchema] of Object.entries(entries)) {
          const path = prefix ? `${prefix}.${key}` : key;

          const desc = this.getDescription(fieldSchema);
          if (desc) {
            fields.push({ path, description: desc });
          }

          this.extractFieldDescriptions(fieldSchema, path, fields, activeSchemas);
        }
        return;
      }

      for (const child of this.getInlineChildren(structural)) {
        this.extractFieldDescriptions(child, prefix, fields, activeSchemas);
      }
    } finally {
      for (const visited of entered) {
        activeSchemas.delete(visited);
      }
    }
  }

  /**
   * Resolves the schema that determines a value's printed shape.
   *
   * `v.pipe()` spreads its first item, so a piped object already exposes its
   * entries - but when a later item is itself a schema (e.g.
   * `v.pipe(v.string(), v.transform(...), v.object({...}))`) that last schema is
   * what shapes the output. Wrappers (`v.optional()`, `v.nullable()`, ...) and
   * `v.lazy()` are unwrapped as well.
   */
  private resolveStructuralSchema(schema: unknown, depth = 0): object | undefined {
    if (!isPlainObject(schema) || depth > MAX_UNWRAP_DEPTH) return undefined;

    const pipe = schema.pipe;
    if (Array.isArray(pipe)) {
      for (let index = pipe.length - 1; index >= 0; index--) {
        const item = pipe[index];
        if (isPlainObject(item) && item.kind === "schema") {
          // pipe[0] is spread onto the schema itself, so stop there to avoid
          // re-resolving the very object we were handed.
          return index === 0 ? schema : this.resolveStructuralSchema(item, depth + 1);
        }
      }
      return schema;
    }

    if (typeof schema.type === "string" && WRAPPER_SCHEMA_TYPES.has(schema.type)) {
      return this.resolveStructuralSchema(schema.wrapped, depth + 1);
    }

    if (schema.type === "lazy" && typeof schema.getter === "function") {
      try {
        return this.resolveStructuralSchema(
          (schema.getter as (input: unknown) => unknown)(undefined),
          depth + 1,
        );
      } catch (error) {
        logDebugError("v.lazy() getter call failed", error);
        return undefined;
      }
    }

    return schema;
  }

  /**
   * Gets the entries of an object schema, if the schema is object-shaped.
   */
  private getEntries(schema: object): Record<string, unknown> | undefined {
    const candidate = schema as { type?: unknown; entries?: unknown };
    if (typeof candidate.type !== "string" || !OBJECT_SCHEMA_TYPES.has(candidate.type)) {
      return undefined;
    }
    return isPlainObject(candidate.entries) ? candidate.entries : undefined;
  }

  /**
   * Gets the child schemas that are printed inline at the parent's own path
   * (array items, tuple members, union options, record values, ...).
   */
  private getInlineChildren(schema: object): unknown[] {
    const candidate = schema as {
      type?: unknown;
      item?: unknown;
      items?: unknown;
      options?: unknown;
      value?: unknown;
      rest?: unknown;
    };
    if (typeof candidate.type !== "string") return [];

    const children: unknown[] = [];

    if (ARRAY_SCHEMA_TYPES.has(candidate.type)) {
      children.push(candidate.item);
    }
    if (TUPLE_SCHEMA_TYPES.has(candidate.type) && Array.isArray(candidate.items)) {
      children.push(...candidate.items);
    }
    if (COMPOSITE_SCHEMA_TYPES.has(candidate.type) && Array.isArray(candidate.options)) {
      children.push(...candidate.options);
    }
    if (VALUE_SCHEMA_TYPES.has(candidate.type)) {
      children.push(candidate.value);
    }
    if (candidate.rest !== undefined) {
      children.push(candidate.rest);
    }

    return children.filter((child) => child !== undefined);
  }

  /**
   * Gets the description of a Valibot schema.
   *
   * Mirrors `v.getDescription()`: the last `v.description()` action in the pipe
   * wins, falling back to nested piped schemas. A `v.metadata({ description })`
   * action is honored too, and wrappers such as `v.optional()` are looked
   * through so a described schema keeps its description when wrapped.
   */
  private getDescription(schema: unknown, depth = 0): string | undefined {
    if (!isPlainObject(schema) || depth > MAX_UNWRAP_DEPTH) return undefined;

    const fromPipe = this.getPipeDescription(schema);
    if (fromPipe !== undefined) return fromPipe;

    if (typeof schema.type === "string" && WRAPPER_SCHEMA_TYPES.has(schema.type)) {
      return this.getDescription(schema.wrapped, depth + 1);
    }

    return undefined;
  }

  /**
   * Reads the description out of a schema's `v.pipe()` items.
   */
  private getPipeDescription(schema: Record<string, unknown>): string | undefined {
    const pipe = schema.pipe;
    if (!Array.isArray(pipe)) return undefined;

    const nestedSchemas: unknown[] = [];

    for (let index = pipe.length - 1; index >= 0; index--) {
      const item = pipe[index];
      if (!isPlainObject(item)) continue;

      if (item.kind === "schema") {
        if (Array.isArray(item.pipe)) nestedSchemas.push(item);
        continue;
      }

      if (item.kind !== "metadata") continue;

      if (item.type === "description" && typeof item.description === "string") {
        return item.description;
      }

      // v.metadata({ description: "..." }) is a supported alternative spelling.
      if (item.type === "metadata" && isPlainObject(item.metadata)) {
        const description = item.metadata.description;
        if (typeof description === "string") return description;
      }
    }

    for (const nested of nestedSchemas) {
      const result = this.getPipeDescription(nested as Record<string, unknown>);
      if (result !== undefined) return result;
    }

    return undefined;
  }
}

/**
 * Maximum wrapper unwrapping depth, as a guard against pathological nesting.
 */
const MAX_UNWRAP_DEPTH = 20;

/**
 * Schema types whose value shape comes from a single `wrapped` schema.
 */
const WRAPPER_SCHEMA_TYPES = new Set([
  "optional",
  "exact_optional",
  "nullable",
  "nullish",
  "undefinedable",
  "non_optional",
  "non_nullable",
  "non_nullish",
]);

/**
 * Schema types that expose named entries.
 */
const OBJECT_SCHEMA_TYPES = new Set([
  "object",
  "strict_object",
  "loose_object",
  "object_with_rest",
]);

/**
 * Schema types with a single `item` schema.
 */
const ARRAY_SCHEMA_TYPES = new Set(["array"]);

/**
 * Schema types with an `items` tuple.
 */
const TUPLE_SCHEMA_TYPES = new Set(["tuple", "loose_tuple", "strict_tuple", "tuple_with_rest"]);

/**
 * Schema types that combine several `options` schemas.
 *
 * `picklist` and `enum` also carry `options`, but theirs are plain values.
 */
const COMPOSITE_SCHEMA_TYPES = new Set(["union", "variant", "intersect"]);

/**
 * Schema types with a single `value` schema.
 */
const VALUE_SCHEMA_TYPES = new Set(["record", "map", "set"]);

/**
 * Narrows a value to a non-null, non-array object.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
