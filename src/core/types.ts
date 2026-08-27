/**
 * Shared type definitions for vinfer.
 */

/**
 * Information about a detected Valibot schema in a source file.
 */
export interface DetectedSchema {
  /** Variable name of the schema */
  name: string;
  /**
   * Identifier the schema is actually declared under in the source file.
   *
   * Differs from `name` for aliased re-exports (`export { XSchema as YSchema }`),
   * where the type must still be read from the original declaration.
   */
  localName?: string;
  /** Whether the schema is exported */
  isExported: boolean;
  /** Line number where the schema is defined */
  line: number;
  /** Explicit type annotation if present (e.g., "Category" from v.GenericSchema<Category>) */
  explicitType?: string;
  /** JSDoc comment if present */
  jsDoc?: string;
}

/**
 * Field description from Valibot's `v.description()` action.
 */
export interface FieldDescription {
  /** Field path (e.g., "user.name" for nested fields) */
  path: string;
  /** Description text */
  description: string;
}

/**
 * Result of extracting types from a single schema.
 */
export interface ExtractResult {
  /** Name of the schema */
  schemaName: string;
  /** Extracted input type as string */
  input: string;
  /** Extracted output type as string */
  output: string;
  /** Whether the original schema was exported */
  isExported: boolean;
  /**
   * Absolute path of the file declaring the schema, when it lives in another
   * file and the types generated for it are referenced by name instead of being
   * inlined. The generated file has to `import type` them from there.
   */
  importedFrom?: string;
  /**
   * The schema's name as declared in `importedFrom`, when it differs from
   * `schemaName` (an aliased named import, e.g. `import { X as Y }`). The
   * declaring file names its generated types after this one, not after the
   * local alias, so the `import type` has to bridge the two with `as`.
   */
  originalName?: string;
  /** Schema-level description from `v.description()` */
  description?: string;
  /** Field descriptions from `v.description()` */
  fieldDescriptions?: FieldDescription[];
}

/**
 * Result of extracting types from a single file with multiple schemas.
 */
export interface FileExtractResult {
  /** Path to the source file */
  filePath: string;
  /** Extracted schemas */
  schemas: ExtractResult[];
}

/**
 * Mapped type names for a schema.
 */
export interface MappedTypeName {
  /** Original schema name */
  originalName: string;
  /** Generated input type name */
  inputName: string;
  /** Generated output type name */
  outputName: string;
  /** Unified name (when input === output) */
  unifiedName: string;
}

/**
 * Options for name mapping.
 */
export interface NameMappingOptions {
  /** Suffix to remove from schema names (e.g., "Schema") */
  removeSuffix?: string;
  /** Suffix to add for input types (default: "Input") */
  inputSuffix?: string;
  /** Suffix to add for output types (default: "Output") */
  outputSuffix?: string;
  /** Custom name mappings */
  customMap?: Record<string, string>;
}

/**
 * Options for output generation.
 */
export interface OutputOptions {
  /** Output directory */
  outDir?: string;
  /** Single output file path */
  outFile?: string;
  /** Output file naming pattern (e.g., "[name].types.ts") */
  outPattern?: string;
  /** Generate .d.ts declaration files */
  declaration?: boolean;
}

/**
 * Generated file information.
 */
export interface GeneratedFile {
  /** Output file path */
  path: string;
  /** File content */
  content: string;
}

/**
 * Options for type declaration formatting.
 */
export interface DeclarationOptions {
  /** Output only input types */
  inputOnly?: boolean;
  /** Output only output types */
  outputOnly?: boolean;
  /** Merge input/output if they are identical */
  mergeSame?: boolean;
  /**
   * Module specifier to `import type` a schema's generated types from, keyed by
   * schema name. Only schemas whose `ExtractResult` carries `importedFrom` are
   * looked up here; an entry is what turns a cross-file reference into an
   * import instead of leaving the name undeclared.
   */
  importSources?: ReadonlyMap<string, string>;
  /**
   * How a `.brand()`/`.flavor()` marker is represented in the generated
   * output. `"valibot-import"` (default) prints `Brand<"Tag">` /
   * `Flavor<"Tag">` and imports `Brand`/`Flavor` from "valibot".
   * `"local-symbol"` prints a self-contained `unique symbol`-keyed property
   * instead, so the generated file never imports valibot.
   */
  brandStrategy?: "valibot-import" | "local-symbol";
}
