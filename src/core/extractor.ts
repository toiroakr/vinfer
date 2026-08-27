import {
  Project,
  SourceFile,
  TypeFormatFlags,
  ts,
  type EnumDeclaration,
  type TypeAliasDeclaration,
  type InterfaceDeclaration,
} from "ts-morph";
import { resolve as resolvePath, isAbsolute } from "pathe";
import { realpathSync } from "fs";
import {
  NORMALIZE_TYPE_DEFINITION,
  NORMALIZE_TYPE_NAMES,
  createTempTypeAlias,
} from "./normalizer.js";
import { SchemaDetector } from "./schema-detector.js";
import { GetterResolver } from "./getter-resolver.js";
import { SchemaReferenceAnalyzer, type SchemaReferenceInfo } from "./schema-reference-analyzer.js";
import { ImportResolver } from "./import-resolver.js";
import { ValibotBindings } from "./valibot-bindings.js";
import { logDebugError } from "./logger.js";
import { isEscaped } from "./string-scan.js";
import type { ExtractResult, FileExtractResult, DetectedSchema } from "./types.js";

// Re-export ExtractResult for backward compatibility
export type { ExtractResult } from "./types.js";

/**
 * A schema's printed input/output types, before cross-schema references are
 * resolved into type names.
 */
interface RawSchemaType {
  input: string;
  output: string;
  isExported: boolean;
  /** Set when the schema is declared in another file that generates types of its own. */
  importedFrom?: string;
  /**
   * The schema's name as declared in `importedFrom`, when it differs from the
   * local name it is cached/keyed under (an aliased named import). The
   * declaring file names its generated types after this one, not after the
   * local alias.
   */
  originalName?: string;
  /**
   * The form to inline this schema as when its own name cannot be used.
   *
   * Only recursive schemas that no file declares types for need one: their
   * printed type names themselves, which is meaningless in a file that never
   * declares that name, so the recursion point is widened to the shape the
   * getter describes instead.
   */
  approximation?: { input: string; output: string };
}

/**
 * Where a name usable bare within some file's own scope actually lives -
 * built by `collectFileLocalTypeReferences` and consumed by
 * `promoteBareTypeReferences`/`resolveReferenceOrFallback`.
 */
interface LocalTypeReference {
  /** The file that declares this name (itself, for a same-file entry). */
  file: SourceFile;
  /** Absolute path, without extension, of `file` - only meaningful when `hasValidFallback`. */
  modulePath: string;
  /** The name `file` declares/exports this under (never a local import alias). */
  exportedName: string;
  /**
   * Whether `import("${modulePath}").${exportedName}` is a valid reference
   * to fall back on if expanding this hits a cycle. False only for a
   * same-file declaration that isn't exported - nothing can import it, so
   * a cycle through it has no resolvable form at all.
   */
  hasValidFallback: boolean;
}

/**
 * Collapses a `| undefined` TypeScript's printer spelled more than once.
 *
 * A homomorphic mapped type - which is what `__Normalize` is - copies an
 * optional property by its indexed access, so a property declared
 * `required?: boolean | undefined` prints as its declared type *and* gets the
 * `| undefined` the printer appends for an optional key under
 * `strictNullChecks`, yielding `required?: boolean | undefined | undefined`.
 * No type can hold that union twice, so dropping the repeat loses nothing.
 *
 * String literal types are skipped: `"a | undefined | undefined"` is text, not a
 * union.
 */
function collapseRepeatedUndefined(typeStr: string): string {
  if (!typeStr.includes("undefined")) {
    return typeStr;
  }

  let result = "";
  let segmentStart = 0;
  let inString = false;
  let stringChar = "";

  const flush = (end: number) => {
    const segment = typeStr.slice(segmentStart, end);
    result += inString
      ? segment
      : segment.replace(/(\|\s*undefined\b)(\s*\|\s*undefined\b)+/g, "$1");
    segmentStart = end;
  };

  for (let index = 0; index < typeStr.length; index++) {
    const char = typeStr[index];
    if ((char !== '"' && char !== "'" && char !== "`") || isEscaped(typeStr, index)) {
      continue;
    }

    if (!inString) {
      flush(index);
      inString = true;
      stringChar = char;
    } else if (char === stringChar) {
      flush(index + 1);
      inString = false;
      stringChar = "";
    }
  }

  flush(typeStr.length);
  return result;
}

/**
 * Rewrites the relative specifiers in printed `import("...")` types to absolute
 * paths.
 *
 * TypeScript prints such a specifier relative to the file the type was read
 * from, which is not where the generated file ends up. Absolute is the form
 * `relativizeImportPaths` already knows how to re-anchor onto the output
 * directory, and it survives results from several source files being merged
 * into one output file.
 *
 * Unlike `collapseRepeatedUndefined`, this cannot reuse
 * `transformOutsideStringLiterals`: the `"..."` an `import()` type names is
 * itself a quoted string, so a literal-boundary scan that treats every quote
 * the same way would skip the very syntax this function exists to rewrite.
 *
 * `sourceDir` is realpath'd first: it always exists (a file was just read
 * from it), and on a symlinked working directory (e.g. macOS's
 * `/var` -> `/private/var` tmpdir) leaving it un-resolved here would produce
 * an absolute path on a different symlink base than the output directory
 * `relativizeImportPaths` later resolves against, corrupting the relative
 * path between the two.
 */
function absolutizeImportPaths(typeStr: string, sourceDir: string): string {
  if (!typeStr.includes('import("')) {
    return typeStr;
  }

  const resolvedSourceDir = realpathSync(sourceDir);
  return typeStr.replace(/import\("([^"]+)"\)/g, (match, importPath: string) => {
    if (!importPath.startsWith(".")) {
      return match;
    }
    return `import("${resolvePath(resolvedSourceDir, importPath)}")`;
  });
}

/**
 * Prints an enum as a literal union of its members' values, for expanding a
 * same-file enum reference reached through an explicit type annotation.
 *
 * Returns `undefined` - leaving the caller's already-printed enum name in
 * place - as soon as one member's value can't be statically resolved (e.g.
 * initialized from a function call), rather than silently dropping just that
 * member and printing a union narrower than the enum itself.
 */
function printEnumAsLiteralUnion(enumDecl: EnumDeclaration): string | undefined {
  const values: string[] = [];
  for (const member of enumDecl.getMembers()) {
    const value = member.getValue();
    if (typeof value === "string") values.push(`"${value}"`);
    else if (typeof value === "number") values.push(value.toString());
    else return undefined;
  }

  return values.length > 0 ? values.join(" | ") : undefined;
}

/**
 * Falls back to a schema's printed input when TypeScript gave up on its
 * output, printing it as a bare `any`.
 */
function withOutputFallback(printedOutput: string, printedInput: string): string {
  return printedOutput === "any" ? printedInput : printedOutput;
}

/**
 * Removes trailing spaces ts-morph 27+ may add to printed type text. Skips
 * split/map/join for single-line types (most common case).
 */
function trimPrintedType(rawType: string): string {
  if (!rawType.includes("\n")) {
    return rawType.trimEnd();
  }
  return rawType
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n");
}

/**
 * Whether `typeText` needs wrapping in parens before the caller appends a
 * suffix like `[]` or an indexed access directly after it, because doing so
 * unparenthesized would bind to only part of the type or change its meaning
 * outright:
 *
 * - A top-level `|` or `&` (union/intersection) - `A | B[]` reads as
 *   `A | (B[])`, not `(A | B)[]`.
 * - A top-level `?` (a conditional type, `T extends U ? A : B`) - the same
 *   binding problem, and a bare `?` never otherwise appears at depth 0 in
 *   printed type text (an optional property/tuple element's `?` is always
 *   inside the `{...}`/`[...]` that owns it).
 * - A top-level `=>` (a function type) - `(x: X) => Y[]` means a function
 *   returning `Y[]`, not an array of such functions; the parameter list's
 *   own `(...)` is already balanced by the time this is reached.
 */
function needsParensBeforeSuffix(typeText: string): boolean {
  let depth = 0;
  let quote: string | undefined;

  for (let i = 0; i < typeText.length; i++) {
    const char = typeText[i];

    if (quote) {
      if (char === quote && !isEscaped(typeText, i)) quote = undefined;
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      quote = char;
    } else if (char === "{" || char === "(" || char === "[" || char === "<") {
      depth++;
    } else if (char === "}" || char === ")" || char === "]") {
      depth--;
    } else if (char === ">") {
      // The `>` of an arrow function type's `=>` never opened a matching
      // `<` - counting it would desync depth tracking for the rest of the
      // string, hiding (or inventing) a top-level construct that needs
      // wrapping. Recognized as its own signal just below instead.
      if (typeText[i - 1] === "=") {
        if (depth === 0) return true;
      } else {
        depth--;
      }
    } else if (depth === 0 && (char === "|" || char === "&" || char === "?")) {
      return true;
    }
  }

  return false;
}

/**
 * Whether `text[afterIdentifier]` begins a generic method signature's own
 * type parameter list (`<T>(`), not a generic type instantiation (`<Args>`
 * with no method call following). Scans a balanced `<...>` run and checks
 * whether `(` immediately follows the close.
 *
 * A type parameter's constraint or default can itself carry an arrow
 * function type (`<T extends (x: string) => void>`) - that `=>`'s `>` never
 * opened a matching `<`, so it must not be counted as a close, the same
 * `=>` exclusion `needsParensBeforeSuffix` applies for the same
 * reason. Miscounting it would close the scan early, at the arrow's own
 * `>`, and misjudge whatever follows.
 */
function isGenericMethodSignature(text: string, afterIdentifier: number): boolean {
  if (text[afterIdentifier] !== "<") return false;

  let depth = 0;
  let i = afterIdentifier;
  for (; i < text.length; i++) {
    if (text[i] === "<") depth++;
    else if (text[i] === ">" && text[i - 1] !== "=") {
      depth--;
      if (depth === 0) {
        i++;
        break;
      }
    }
  }

  return text[i] === "(";
}

/**
 * The module specifier form of a file's own path: absolute, without a
 * source extension, matching what TypeScript itself prints inside a
 * synthesized `import("...")` type and what `resolveModuleSourceFile`
 * resolves back from - so a type reached either way lands on the same
 * cycle-detection key.
 */
function modulePathFor(sourceFile: SourceFile): string {
  // Realpath'd for the same reason absolutizeImportPaths's sourceDir is: a
  // symlinked ancestor directory (e.g. macOS's /var -> /private/var tmpdir)
  // would otherwise make this land on a different symlink base than the
  // import("...") text absolutizeImportPaths already produced, corrupting
  // both resolveModuleSourceFile's filesystem lookup and the cycle-detection
  // keys built from it.
  //
  // realpathSync returns OS-native separators, which are backslashes on
  // Windows - embedding that directly into an import("...") string would
  // produce an invalid module specifier (and a mis-escaped string literal).
  // Routed through pathe's resolve(), the same normalization
  // absolutizeImportPaths already relies on for its own realpath'd
  // sourceDir, to always land on the forward-slash form.
  return resolvePath(realpathSync(sourceFile.getFilePath())).replace(
    /\.d\.(ts|mts|cts)$|\.(ts|tsx|mts|cts)$/,
    "",
  );
}

/**
 * Options for type extraction.
 */
export interface ExtractOptions {
  /** Absolute or relative path to the TypeScript file containing the Valibot schema */
  filePath: string;
  /** Name of the exported Valibot schema (e.g., "UserSchema") */
  schemaName: string;
  /** Optional path to tsconfig.json for project configuration */
  tsconfigPath?: string;
}

/**
 * Extra context that lets extraction reach beyond the file being processed.
 */
export interface ExtractContext {
  /**
   * Absolute paths of the files that get generated types of their own.
   *
   * A recursive schema imported from one of them is referenced by name rather
   * than inlined - an inline copy of a recursive type can only ever be an
   * approximation - leaving the caller to `import type` it. Schemas from files
   * outside this set are inlined as before.
   */
  importableFiles?: ReadonlySet<string>;
  /**
   * When an explicit `v.GenericSchema<T>` annotation's `T` reaches a plain
   * (non-schema) type declared in another file, TypeScript's printer
   * synthesizes an `import("...").Name` reference to it rather than
   * expanding it in place - there is nothing else to point at from this
   * print location. Setting this replaces that reference with the
   * referenced type's own structure instead, recursively, so the generated
   * output carries no dependency on the original file layout. A reference
   * that would recurse into itself (directly or through another file) is
   * left as `import(...)` at the point it would cycle - see
   * `inlineExternalTypeReferences`.
   */
  inlineExternalTypes?: boolean;
}

/**
 * Extracts input and output types from Valibot schemas using TypeScript Compiler API.
 */
export class ValibotTypeExtractor {
  private project: Project;
  private schemaDetector: SchemaDetector;
  private getterResolver: GetterResolver;
  private referenceAnalyzer: SchemaReferenceAnalyzer;
  private importResolver: ImportResolver;
  private importedSchemaCache = new Map<string, Omit<RawSchemaType, "isExported">>();

  /**
   * Creates a new ValibotTypeExtractor instance.
   *
   * @param tsconfigPath - Optional path to tsconfig.json. If not provided,
   *                       default compiler options will be used.
   */
  constructor(tsconfigPath?: string) {
    this.project = this.createProject(tsconfigPath);
    this.schemaDetector = new SchemaDetector();
    this.getterResolver = new GetterResolver();
    this.referenceAnalyzer = new SchemaReferenceAnalyzer();
    this.importResolver = new ImportResolver(this.schemaDetector);
  }

  /**
   * Extracts input and output types from a Valibot schema.
   *
   * @param options - Extraction options including file path and schema name
   * @returns The extracted input and output types as strings
   */
  extract(options: ExtractOptions): ExtractResult {
    const { filePath, schemaName } = options;

    // Use extractMultiple to handle explicit type annotations properly
    const results = this.extractMultiple(filePath, [schemaName]);

    if (results.length === 0) {
      throw new Error(`Schema "${schemaName}" not found in ${filePath}`);
    }

    return results[0];
  }

  /**
   * Extracts types from all exported Valibot schemas in a file.
   *
   * @param filePath - Path to the TypeScript file
   * @returns Array of extraction results for each schema
   */
  extractAll(filePath: string, context: ExtractContext = {}): ExtractResult[] {
    const sourceFile = this.getOrAddSourceFile(filePath);
    const schemas = this.schemaDetector.detectExportedSchemas(sourceFile);

    return this.extractMultipleFromSourceFile(sourceFile, schemas, context);
  }

  /**
   * Extracts types from specific schemas in a file.
   *
   * @param filePath - Path to the TypeScript file
   * @param schemaNames - Names of schemas to extract
   * @returns Array of extraction results
   */
  extractMultiple(
    filePath: string,
    schemaNames: string[],
    context: ExtractContext = {},
  ): ExtractResult[] {
    const sourceFile = this.getOrAddSourceFile(filePath);
    const allSchemas = this.schemaDetector.detectExportedSchemas(sourceFile);
    const schemas = schemaNames.map((name) => {
      const found = allSchemas.find((s) => s.name === name);
      return found || { name, isExported: true, line: 0 };
    });

    return this.extractMultipleFromSourceFile(sourceFile, schemas, context);
  }

  /**
   * Extracts types from all exported schemas and returns file-level result.
   *
   * @param filePath - Path to the TypeScript file
   * @returns File extraction result with all schemas
   */
  extractFile(filePath: string, context: ExtractContext = {}): FileExtractResult {
    return {
      filePath,
      schemas: this.extractAll(filePath, context),
    };
  }

  /**
   * Gets the list of detected schema names in a file.
   *
   * @param filePath - Path to the TypeScript file
   * @returns Array of schema names
   */
  getSchemaNames(filePath: string): string[] {
    return this.schemaDetector.getSchemaNames(this.getOrAddSourceFile(filePath));
  }

  /**
   * Gets or adds a source file to the project.
   */
  private getOrAddSourceFile(filePath: string): SourceFile {
    return this.project.getSourceFile(filePath) ?? this.project.addSourceFileAtPath(filePath);
  }

  /**
   * Internal method to extract multiple schemas from a source file.
   */
  private extractMultipleFromSourceFile(
    sourceFile: SourceFile,
    schemas: DetectedSchema[],
    context: ExtractContext = {},
  ): ExtractResult[] {
    const results: ExtractResult[] = [];

    // Find and resolve imported schemas
    const importedSchemas = this.importResolver.findImportedSchemas(sourceFile, this.project);

    // Build schema names set including imports
    const schemaNames = new Set(schemas.map((s) => s.name));
    for (const localName of importedSchemas.keys()) {
      schemaNames.add(localName);
    }

    // Analyze getter fields for target schemas only
    const getterFieldMap = this.getterResolver.analyzeGetterFields(sourceFile, schemaNames);

    // Analyze cross-schema references and union references in a single pass
    const { references: referenceMap, unionReferences: unionReferenceMap } =
      this.referenceAnalyzer.analyzeAllReferences(sourceFile, schemaNames);

    // First pass: extract raw types for all schemas
    const rawTypes = new Map<string, RawSchemaType>();

    // Inject __Normalize once for the main source file
    this.ensureNormalizeType(sourceFile);

    // Extract types from imported schemas first
    for (const [localName, importInfo] of importedSchemas) {
      if (!importInfo.resolved) continue;

      const isImportable = context.importableFiles?.has(importInfo.sourceFilePath) ?? false;
      // The self-references a recursive schema needs are spelled with the local
      // name, and what they point at depends on whether the declaring file is
      // generated, so both belong in the cache key alongside the declaration.
      const cacheKey = `${importInfo.sourceFilePath}:${importInfo.originalName}:${localName}:${isImportable}:${Boolean(context.inlineExternalTypes)}`;
      const cached = this.importedSchemaCache.get(cacheKey);
      if (cached) {
        rawTypes.set(localName, { ...cached, isExported: false });
        continue;
      }

      const importedSourceFile = this.project.getSourceFile(importInfo.sourceFilePath);
      if (!importedSourceFile) continue;

      this.ensureNormalizeType(importedSourceFile);
      try {
        this.injectTemporaryTypes(importedSourceFile, importInfo.originalName);
        const raw = this.resolveImportedSchemaType(
          importedSourceFile,
          importInfo.originalName,
          localName,
          isImportable,
          context.inlineExternalTypes,
        );

        // Cache the result
        this.importedSchemaCache.set(cacheKey, raw);

        // Use local name as the key (how it's referenced in current file)
        rawTypes.set(localName, { ...raw, isExported: false });
      } catch (error) {
        logDebugError(`Failed to extract imported schema "${localName}"`, error);
      } finally {
        this.cleanupTemporaryTypes(importedSourceFile);
        this.cleanupNormalizeType(importedSourceFile);
      }
    }

    // Extract types from local schemas
    for (const schema of schemas) {
      const { name: schemaName, localName, explicitType, isExported } = schema;

      if (explicitType) {
        this.injectExplicitType(sourceFile, explicitType);
        try {
          const resolvedType = this.resolveType(
            sourceFile,
            "__TempExplicit",
            context.inlineExternalTypes,
          );
          rawTypes.set(schemaName, {
            input: resolvedType,
            output: resolvedType,
            isExported,
          });
        } finally {
          this.cleanupExplicitType(sourceFile);
        }
        continue;
      }

      this.injectTemporaryTypes(sourceFile, localName ?? schemaName);
      try {
        const rawInput = this.resolveType(sourceFile, "__TempInput", context.inlineExternalTypes);
        const printedOutput = this.resolveType(
          sourceFile,
          "__TempOutput",
          context.inlineExternalTypes,
        );
        const rawOutput = withOutputFallback(printedOutput, rawInput);

        let input = rawInput;
        let output = rawOutput;
        let approximation: RawSchemaType["approximation"];

        // Resolve getter-based self-references
        const getterFields = getterFieldMap.get(schemaName);
        if (getterFields && this.getterResolver.hasSelfReferences(getterFields)) {
          input = this.getterResolver.resolveAnyTypes(rawInput, getterFields, `${schemaName}Input`);
          output = this.getterResolver.resolveAnyTypes(
            rawOutput,
            getterFields,
            `${schemaName}Output`,
          );

          if (!isExported) {
            // Nothing will declare this schema's types, so a reference to it has
            // to be inlined - and an inlined recursive type can only ever be an
            // approximation. Keep one whose recursion point is the index
            // signature or array the getter describes, rather than a bare `any`.
            const options = { collapseInlinedCopies: false };
            approximation = {
              input: this.getterResolver.resolveAnyTypes(rawInput, getterFields, "any", options),
              output: this.getterResolver.resolveAnyTypes(rawOutput, getterFields, "any", options),
            };
          }
        }

        rawTypes.set(schemaName, { input, output, isExported, approximation });
      } finally {
        this.cleanupTemporaryTypes(sourceFile);
      }
    }

    // Clean up __Normalize from the main source file after all schemas are processed
    this.cleanupNormalizeType(sourceFile);

    const schemasByName = new Map(schemas.map((schema) => [schema.name, schema]));
    const resolvedTypes = new Map<string, { input: string; output: string }>();
    const resolvingSchemas = new Set<string>();

    const resolveSchemaTypes = (
      schemaName: string,
    ): { input: string; output: string } | undefined => {
      const cached = resolvedTypes.get(schemaName);
      if (cached) return cached;

      const raw = rawTypes.get(schemaName);
      if (!raw) return undefined;

      if (resolvingSchemas.has(schemaName)) {
        return { input: raw.input, output: raw.output };
      }
      resolvingSchemas.add(schemaName);

      let { input, output } = raw;
      const unionRef = unionReferenceMap.get(schemaName);

      const shouldComposeUnion =
        unionRef &&
        unionRef.memberSchemas.length > 0 &&
        (unionRef.memberSchemas.every((member) => rawTypes.get(member)?.isExported) ||
          (!unionRef.hasInlineMembers &&
            (unionRef.memberSchemas.some((member) => importedSchemas.has(member)) ||
              unionRef.memberSchemas.some((member) => {
                if (rawTypes.get(member)?.isExported) return false;
                return (referenceMap.get(member) ?? []).some(
                  (ref) => rawTypes.get(ref.refSchema)?.isExported,
                );
              }))));

      if (unionRef && shouldComposeUnion) {
        const inputMembers: string[] = [];
        const outputMembers: string[] = [];
        let canComposeUnion = true;

        for (const member of unionRef.memberSchemas) {
          const memberRaw = rawTypes.get(member);
          if (!memberRaw) continue;

          if (memberRaw.isExported) {
            inputMembers.push(`${member}Input`);
            outputMembers.push(`${member}Output`);
            continue;
          }

          const resolvedMember = resolveSchemaTypes(member);
          if (!resolvedMember) continue;
          if (
            resolvedMember.input.includes(`${member}Input`) ||
            resolvedMember.output.includes(`${member}Output`)
          ) {
            canComposeUnion = false;
            break;
          }
          inputMembers.push(resolvedMember.input);
          outputMembers.push(resolvedMember.output);
        }

        if (canComposeUnion && inputMembers.length === unionRef.memberSchemas.length) {
          input = inputMembers.join(" | ");
          output = outputMembers.join(" | ");
        }
      }

      const refs = referenceMap.get(schemaName) || [];
      for (const ref of refs) {
        const refRaw = rawTypes.get(ref.refSchema);
        if (!refRaw) continue;

        // A schema is referenced by name when this file declares its types, or
        // when another generated file does and they can be imported from there.
        if (refRaw.isExported || refRaw.importedFrom) {
          input = this.replaceSchemaReference(input, ref, refRaw.input, `${ref.refSchema}Input`);
          output = this.replaceSchemaReference(
            output,
            ref,
            refRaw.output,
            `${ref.refSchema}Output`,
          );
          continue;
        }

        // Nothing declares this schema's types, so it stays inlined - but from
        // its own resolved form rather than from what TypeScript printed here,
        // so the references it makes to schemas that *are* declared survive
        // being nested inside it.
        const resolvedRef = resolveSchemaTypes(ref.refSchema);
        const inlineInput = this.inlinableForm(resolvedRef?.input, refRaw, ref.refSchema, "Input");
        const inlineOutput = this.inlinableForm(
          resolvedRef?.output,
          refRaw,
          ref.refSchema,
          "Output",
        );

        if (inlineInput !== undefined) {
          input = this.replaceSchemaReference(input, ref, refRaw.input, inlineInput);
        }
        if (inlineOutput !== undefined) {
          output = this.replaceSchemaReference(output, ref, refRaw.output, inlineOutput);
        }
      }

      const explicitType = schemasByName.get(schemaName)?.explicitType;
      if (explicitType && this.isLocallyDeclaredType(sourceFile, explicitType)) {
        const escapedTypeName = this.escapeRegExp(explicitType);
        const typeNamePattern = new RegExp(`\\b${escapedTypeName}\\b`, "g");
        input = input.replace(typeNamePattern, `${schemaName}Input`);
        output = output.replace(typeNamePattern, `${schemaName}Output`);
      }

      resolvingSchemas.delete(schemaName);
      const resolved = { input, output };
      resolvedTypes.set(schemaName, resolved);
      return resolved;
    };

    // Add imported schemas to results first (so they're defined before use)
    for (const [localName] of importedSchemas) {
      const raw = rawTypes.get(localName);
      if (!raw) continue;

      results.push({
        schemaName: localName,
        input: raw.input,
        output: raw.output,
        isExported: false, // Imported schemas are not re-exported
        ...(raw.importedFrom
          ? { importedFrom: raw.importedFrom, originalName: raw.originalName }
          : {}),
      });
    }

    // Second pass: replace cross-schema references with type names
    for (const schema of schemas) {
      const schemaName = schema.name;
      const raw = rawTypes.get(schemaName);
      if (!raw) continue;

      const resolved = resolveSchemaTypes(schemaName);
      if (!resolved) continue;

      results.push({
        schemaName,
        input: resolved.input,
        output: resolved.output,
        isExported: raw.isExported,
      });
    }

    return results;
  }

  /**
   * Picks the form a schema whose types nothing declares is inlined as.
   *
   * @returns The type to inline, or undefined to leave the reference as
   *   TypeScript printed it
   */
  private inlinableForm(
    resolved: string | undefined,
    raw: RawSchemaType,
    refSchema: string,
    kind: "Input" | "Output",
  ): string | undefined {
    const printed = kind === "Input" ? raw.input : raw.output;
    const approximation = kind === "Input" ? raw.approximation?.input : raw.approximation?.output;
    const candidate = resolved ?? printed;

    // A recursive schema names itself, and nothing declares that name here, so
    // only the approximation can be inlined.
    if (new RegExp(`\\b${this.escapeRegExp(`${refSchema}${kind}`)}\\b`).test(candidate)) {
      return approximation;
    }

    // The schema's own printed form is already an approximation - it is a
    // recursive one from a file that gets no generated types - and says more
    // than what TypeScript printed here, which lost the recursion entirely.
    if (approximation !== undefined) {
      return approximation;
    }

    // Otherwise only a form that resolving actually changed is worth inlining:
    // it carries names TypeScript could not have printed. When resolving
    // changed nothing, what TypeScript expanded at the reference site is the
    // more faithful of the two - an explicit `v.GenericSchema<T>` annotation is
    // printed as written, down to the `import()` types it names.
    return candidate !== printed ? candidate : undefined;
  }

  /**
   * Replaces an inline schema reference with a type name.
   */
  private replaceSchemaReference(
    typeStr: string,
    ref: SchemaReferenceInfo,
    refTypeStr: string,
    refTypeName: string,
  ): string {
    const { fieldPath, isArray, isRecord } = ref;

    // Build the replacement type
    let replacement = refTypeName;
    if (isArray) {
      replacement = `${refTypeName}[]`;
    }

    // Find the field and replace its value
    const fieldPatterns = [`${fieldPath}: `, `${fieldPath}?: `];

    for (const pattern of fieldPatterns) {
      const idx = typeStr.indexOf(pattern);
      if (idx === -1) continue;

      const valueStart = idx + pattern.length;

      // Find the end of the field value by tracking braces/brackets
      let depth = 0;
      let endIdx = valueStart;
      let inString = false;

      while (endIdx < typeStr.length) {
        const char = typeStr[endIdx];

        if (char === '"' || char === "'") {
          inString = !inString;
        } else if (!inString) {
          if (char === "{" || char === "[" || char === "(") {
            depth++;
          } else if (char === "}" || char === "]" || char === ")") {
            if (depth === 0) break;
            depth--;
          } else if (char === ";" && depth === 0) {
            break;
          }
        }
        endIdx++;
      }

      // Extract the current value
      const currentValue = typeStr.substring(valueStart, endIdx).trim();

      // Check if this looks like an expanded type that should be replaced
      // Handle: { ... }, readonly { ... }[], SomeType, etc.
      const valueToCheck = currentValue
        .replace(/^readonly\s+/, "")
        .replace(/\[\]$/, "")
        .trim();

      if (
        valueToCheck.startsWith("{") ||
        valueToCheck === refTypeStr ||
        currentValue.includes("[x: string]:")
      ) {
        // Handle record type
        if (isRecord) {
          replacement = `{ [x: string]: ${refTypeName}; }`;
        }

        // Preserve readonly prefix for arrays
        if (isArray && currentValue.startsWith("readonly ")) {
          replacement = `readonly ${replacement}`;
        }

        return typeStr.substring(0, valueStart) + replacement + typeStr.substring(endIdx);
      }
    }

    return typeStr;
  }

  /**
   * Injects temporary type for explicit type (without normalization for circular refs).
   */
  private injectExplicitType(sourceFile: SourceFile, explicitType: string): void {
    // Don't normalize - use the type directly to preserve circular references
    sourceFile.addStatements([`type __TempExplicit = ${explicitType};`]);
  }

  /**
   * Cleans up explicit type temporaries.
   */
  private cleanupExplicitType(sourceFile: SourceFile): void {
    const typeAlias = sourceFile.getTypeAlias("__TempExplicit");
    if (typeAlias) {
      typeAlias.remove();
    }
  }

  /**
   * Creates a ts-morph Project with appropriate compiler options.
   */
  private createProject(tsconfigPath?: string): Project {
    if (tsconfigPath) {
      return new Project({
        tsConfigFilePath: tsconfigPath,
        skipAddingFilesFromTsConfig: true,
        skipFileDependencyResolution: true,
      });
    }

    return new Project({
      skipFileDependencyResolution: true,
      compilerOptions: {
        strict: true,
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        esModuleInterop: true,
        skipLibCheck: true,
      },
    });
  }

  /**
   * Injects the __Normalize type definition into a source file if not already present.
   */
  private ensureNormalizeType(sourceFile: SourceFile): void {
    if (!sourceFile.getTypeAlias("__Normalize")) {
      sourceFile.addStatements([NORMALIZE_TYPE_DEFINITION]);
    }
  }

  /**
   * Removes the __Normalize type definition from a source file.
   */
  private cleanupNormalizeType(sourceFile: SourceFile): void {
    for (const name of NORMALIZE_TYPE_NAMES) {
      sourceFile.getTypeAlias(name)?.remove();
    }
  }

  /**
   * Injects temporary type aliases into the source file.
   * The __Normalize type must already be present (via ensureNormalizeType).
   * These are added in-memory only and never saved to disk.
   */
  private injectTemporaryTypes(sourceFile: SourceFile, schemaName: string): void {
    sourceFile.addStatements([
      createTempTypeAlias(schemaName, "input"),
      createTempTypeAlias(schemaName, "output"),
    ]);
  }

  /**
   * Resolves a type alias and returns its fully expanded string representation.
   */
  private resolveType(
    sourceFile: SourceFile,
    typeName: string,
    inlineExternalTypes = false,
  ): string {
    const typeAlias = sourceFile.getTypeAlias(typeName);
    if (!typeAlias) {
      throw new Error(`Failed to find type alias: ${typeName}`);
    }

    const type = typeAlias.getType();

    // Use TypeFormatFlags to get the fully expanded type without truncation
    // Don't use UseAliasDefinedOutsideCurrentScope to expand enum types
    const formatFlags = TypeFormatFlags.NoTruncation | TypeFormatFlags.InTypeAlias;

    let rawType = type.getText(typeAlias, formatFlags);
    rawType = trimPrintedType(rawType);

    // Expand enum types: if the type is a single identifier, check if it's an enum
    if (/^[A-Z][a-zA-Z0-9]*$/.test(rawType)) {
      const enumDecl = sourceFile.getEnum(rawType);
      if (enumDecl) {
        rawType = printEnumAsLiteralUnion(enumDecl) ?? rawType;
      }
    }

    rawType = collapseRepeatedUndefined(rawType);
    rawType = absolutizeImportPaths(rawType, sourceFile.getDirectoryPath());

    if (inlineExternalTypes) {
      rawType = this.inlineExternalTypeReferences(rawType, new Set());
    }

    // Reduce Valibot type references (Brand/Flavor) to their bare names so the
    // generated file can import them from "valibot" directly.
    return ValibotBindings.from(sourceFile).canonicalizeTypeNames(rawType);
  }

  /**
   * Replaces `import("path").TypeName` references to a plain (non-schema)
   * type declared in another file with that type's own structure, so the
   * generated output no longer depends on the original file layout.
   *
   * `visiting` tracks the `file#TypeName` pairs currently being expanded in
   * this call chain. A reference that would revisit one of them - a type
   * that (directly or through another file) refers back to itself - is left
   * as `import(...)` at that point instead of recursing forever; everything
   * that isn't part of the cycle is still fully expanded.
   *
   * Scoped to plain types only: a reference this can't resolve to a
   * `type`/`interface`/`enum` declaration (a class, a renamed/default
   * export, or anything else `resolveExternalTypeReference` gives up on) is
   * left as `import(...)` unchanged - the same safe fallback already relied
   * on for a local `v.GenericSchema<T>` annotation that names a type this
   * file cannot rewrite.
   *
   * Only `import("path").Name` on its own is expanded - `import("path")
   * .Name.Member` (a qualified name, e.g. an enum member) or
   * `import("path").Name<Args>` (a generic instantiation) is left as-is:
   * substituting only `Name` would strand `.Member`/`<Args>` against
   * whatever replaces it. The identifier after the dot is found by a plain
   * character scan, not a regex lookahead - a backtracking engine can
   * satisfy `(?!\s*<)` by giving back characters (matching `Bo` instead of
   * `Box` when `Box<string>` follows), which a scan never does.
   */
  private inlineExternalTypeReferences(rawType: string, visiting: Set<string>): string {
    if (!rawType.includes('import("')) return rawType;

    const importPrefix = /import\("([^"]+)"\)\./g;
    let result = "";
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = importPrefix.exec(rawType))) {
      const modulePath = match[1];
      const nameStart = match.index + match[0].length;

      let nameEnd = nameStart;
      while (nameEnd < rawType.length && /[A-Za-z0-9_$]/.test(rawType[nameEnd])) nameEnd++;
      const typeName = rawType.slice(nameStart, nameEnd);

      result += rawType.slice(lastIndex, match.index);

      const nextChar = rawType[nameEnd];
      // `typeof import("...").Name` is a valid type query pointing at a
      // value, not a type - `typeof` followed by Name's expanded structure
      // (`typeof { ... }`) is not valid syntax at all. The printer always
      // normalizes to exactly one space after `typeof`.
      const isTypeQuery = rawType.slice(0, match.index).endsWith("typeof ");
      const isQualifiedOrGeneric = nextChar === "." || nextChar === "<";
      const targetFile =
        isQualifiedOrGeneric || isTypeQuery ? undefined : this.resolveModuleSourceFile(modulePath);

      result += targetFile
        ? this.resolveOrKeepImportText(
            targetFile,
            typeName,
            rawType.slice(match.index, nameEnd),
            visiting,
          )
        : rawType.slice(match.index, nameEnd);

      lastIndex = nameEnd;
      importPrefix.lastIndex = nameEnd;
    }

    result += rawType.slice(lastIndex);
    return result;
  }

  /**
   * The `import("path").Name` matched-text branch of `inlineExternalTypeReferences`:
   * expand `typeName` in `targetFile`, or fall back to `originalText`
   * unchanged (on a cycle, or when it isn't a plain type declaration).
   */
  private resolveOrKeepImportText(
    targetFile: SourceFile,
    typeName: string,
    originalText: string,
    visiting: Set<string>,
  ): string {
    const key = `${targetFile.getFilePath()}#${typeName}`;
    if (visiting.has(key)) return originalText;

    visiting.add(key);
    try {
      const expanded = this.resolveExternalTypeReference(targetFile, typeName, visiting);
      if (expanded === undefined) return originalText;
      return needsParensBeforeSuffix(expanded) ? `(${expanded})` : expanded;
    } finally {
      visiting.delete(key);
    }
  }

  /**
   * Looks up `typeName` as a type alias, interface, or enum declared in
   * `targetFile` and returns its expanded structure - recursing into any
   * further external references it carries. Returns undefined when
   * `typeName` isn't one of those (a class, or an export this couldn't
   * match by its declared name), leaving the caller's `import(...)` as-is.
   */
  private resolveExternalTypeReference(
    targetFile: SourceFile,
    typeName: string,
    visiting: Set<string>,
  ): string | undefined {
    const typeAlias = targetFile.getTypeAlias(typeName);
    if (typeAlias) {
      return this.expandExternalDeclaration(targetFile, typeAlias, visiting);
    }

    const iface = targetFile.getInterface(typeName);
    if (iface) {
      return this.expandExternalDeclaration(targetFile, iface, visiting);
    }

    const enumDecl = targetFile.getEnum(typeName);
    if (enumDecl) {
      return printEnumAsLiteralUnion(enumDecl);
    }

    return undefined;
  }

  /**
   * Prints a type alias's or interface's own structure and recurses into
   * whatever further references it carries - both the `import("...")`
   * TypeScript itself synthesizes for names invisible from `targetFile`,
   * and the bare names of anything that *is* visible there (its own
   * same-file declarations, or types it imports for its own use). The
   * latter print exactly like any other in-scope identifier - correct
   * only inside `targetFile` itself - so `promoteBareTypeReferences` has
   * to turn them into the same explicit, resolvable form before this text
   * is embedded anywhere else.
   */
  private expandExternalDeclaration(
    targetFile: SourceFile,
    declaration: TypeAliasDeclaration | InterfaceDeclaration,
    visiting: Set<string>,
  ): string {
    const formatFlags = TypeFormatFlags.NoTruncation | TypeFormatFlags.InTypeAlias;
    let text = declaration.getType().getText(declaration, formatFlags);
    text = trimPrintedType(text);
    text = absolutizeImportPaths(text, targetFile.getDirectoryPath());
    text = this.promoteBareTypeReferences(text, targetFile, visiting);
    return this.inlineExternalTypeReferences(text, visiting);
  }

  /**
   * Replaces bare identifiers in `text` - printed type text read from
   * `targetFile`, valid only within its own scope - with an explicit,
   * resolvable reference: either the fully expanded structure of the type
   * they name, or (only on a cycle, and only when that type is exported
   * from wherever it's declared) an `import("...")` pointing at it.
   *
   * A same-file declaration that isn't exported has no importable name to
   * fall back to - a cycle through one is left as the bare identifier, the
   * same documented limitation as a non-exported local explicit-annotation
   * type.
   */
  private promoteBareTypeReferences(
    text: string,
    targetFile: SourceFile,
    visiting: Set<string>,
  ): string {
    const references = this.collectFileLocalTypeReferences(targetFile);
    if (references.size === 0) return text;

    let result = "";
    let quote: string | undefined;
    let i = 0;

    while (i < text.length) {
      const char = text[i];

      if (quote) {
        result += char;
        if (char === quote && !isEscaped(text, i)) quote = undefined;
        i++;
        continue;
      }

      if (char === '"' || char === "'" || char === "`") {
        quote = char;
        result += char;
        i++;
        continue;
      }

      if (/[A-Za-z_$]/.test(char)) {
        let end = i + 1;
        while (end < text.length && /[A-Za-z0-9_$]/.test(text[end])) end++;
        const word = text.slice(i, end);

        const precededByDot = i > 0 && text[i - 1] === ".";
        // The checker prints a property key as `name:`/`name?:` with no
        // space before the colon - a bare type reference never precedes a
        // colon this way (a conditional type's ` ? ` / ` : ` both carry a
        // space), so this is how the two are told apart without a parser.
        const nextChar = text[end];
        const isPropertyKey = nextChar === ":" || (nextChar === "?" && text[end + 1] === ":");
        // A method signature's name (`Name(): T`, or a generic method's own
        // `Name<T>(): T`) is not a type reference at all - substituting it
        // would corrupt the method's own name, not a type. Checking only
        // `nextChar === "("` misses the generic form, where `<` reads as
        // `isQualifiedOrGeneric` instead and would strand `<T>(): T` after
        // an `import("...").Name` substitution - invalid syntax, since a
        // method signature's name can never be a qualified expression.
        const isMethodName = nextChar === "(" || isGenericMethodSignature(text, end);
        // `Name.Member` (a qualified name, e.g. an enum member) or
        // `Name<Args>` (a generic instantiation): substituting only `Name`
        // would strand `.Member`/`<Args>` against whatever replaces it.
        // `import("...").Name` keeps both suffixes valid; expanding Name's
        // own structure in place would not, so this reference is only ever
        // qualified, never expanded.
        const isQualifiedOrGeneric = nextChar === "." || nextChar === "<";
        // `typeof Name` is a type query pointing at a value, not a type -
        // `typeof` followed by Name's expanded structure (`typeof { ... }`)
        // isn't valid syntax at all, so this can only ever be qualified.
        const isTypeQuery = result.endsWith("typeof ");

        const reference = references.get(word);
        result +=
          reference && !precededByDot && !isPropertyKey && !isMethodName
            ? isQualifiedOrGeneric || isTypeQuery
              ? this.referenceFallbackText(reference, word)
              : this.resolveReferenceOrFallback(reference, word, visiting)
            : word;
        i = end;
        continue;
      }

      result += char;
      i++;
    }

    return result;
  }

  /**
   * Resolves one entry from `collectFileLocalTypeReferences`: expands it
   * (recursing, with the same cycle handling as `inlineExternalTypeReferences`),
   * or - on a cycle - falls back to an `import(...)` reference if one is
   * valid, else the original bare identifier.
   */
  private resolveReferenceOrFallback(
    reference: LocalTypeReference,
    word: string,
    visiting: Set<string>,
  ): string {
    const key = `${reference.file.getFilePath()}#${reference.exportedName}`;
    const fallback = this.referenceFallbackText(reference, word);

    if (visiting.has(key)) return fallback;

    visiting.add(key);
    try {
      const expanded = this.resolveExternalTypeReference(
        reference.file,
        reference.exportedName,
        visiting,
      );
      if (expanded === undefined) return fallback;
      return needsParensBeforeSuffix(expanded) ? `(${expanded})` : expanded;
    } finally {
      visiting.delete(key);
    }
  }

  /**
   * The safe, non-expanding text for a reference: an `import(...)` pointing
   * at it if one is valid, else the original bare identifier unchanged.
   */
  private referenceFallbackText(reference: LocalTypeReference, word: string): string {
    return reference.hasValidFallback
      ? `import("${reference.modulePath}").${reference.exportedName}`
      : word;
  }

  /**
   * Maps every name usable bare within `targetFile`'s own scope - its own
   * exported or non-exported type/interface/enum declarations, and named
   * imports of the same (default and namespace imports aren't tracked;
   * a bare reference through either is left untouched, the same fallback
   * as an unresolvable one) - to where it actually lives.
   */
  private collectFileLocalTypeReferences(targetFile: SourceFile): Map<string, LocalTypeReference> {
    const references = new Map<string, LocalTypeReference>();
    const selfModulePath = modulePathFor(targetFile);

    const addLocal = (name: string, isExported: boolean): void => {
      references.set(name, {
        file: targetFile,
        modulePath: selfModulePath,
        exportedName: name,
        hasValidFallback: isExported,
      });
    };

    for (const typeAlias of targetFile.getTypeAliases()) {
      addLocal(typeAlias.getName(), typeAlias.isExported());
    }
    for (const iface of targetFile.getInterfaces()) {
      addLocal(iface.getName(), iface.isExported());
    }
    for (const enumDecl of targetFile.getEnums()) {
      addLocal(enumDecl.getName(), enumDecl.isExported());
    }

    for (const importDecl of targetFile.getImportDeclarations()) {
      const moduleSourceFile = importDecl.getModuleSpecifierSourceFile();
      if (!moduleSourceFile) continue;

      const modulePath = modulePathFor(moduleSourceFile);
      for (const namedImport of importDecl.getNamedImports()) {
        const localName = namedImport.getAliasNode()?.getText() ?? namedImport.getName();
        references.set(localName, {
          file: moduleSourceFile,
          modulePath,
          exportedName: namedImport.getName(),
          hasValidFallback: true,
        });
      }
    }

    return references;
  }

  /**
   * Resolves a printed `import("...")` module specifier to the `SourceFile`
   * it points at, trying each extension TypeScript itself would resolve.
   * Loads the file into the shared project on demand so a type declared
   * there can be read the same way as any file passed to `extractAll`.
   *
   * Only an absolute specifier is probed as a filesystem path.
   * `absolutizeImportPaths` already makes every relative specifier (`./...`)
   * TypeScript prints absolute, so a non-absolute one here is a bare
   * package specifier (`import("valibot").Foo`) - treating it as a relative
   * filename could accidentally resolve to an unrelated same-named local
   * file the caller never intended to reach.
   */
  private resolveModuleSourceFile(modulePath: string): SourceFile | undefined {
    if (!isAbsolute(modulePath)) return undefined;

    for (const ext of [".ts", ".tsx", ".mts", ".cts", ".d.ts", ".d.mts", ".d.cts"]) {
      const candidate = `${modulePath}${ext}`;
      const sourceFile =
        this.project.getSourceFile(candidate) ??
        this.project.addSourceFileAtPathIfExists(candidate);
      if (sourceFile) return sourceFile;
    }
    return undefined;
  }

  /**
   * Resolves an imported schema's printed types, including its own recursion.
   *
   * The getters of an imported schema live in the file that declares it, so its
   * recursion has to be resolved against that file. What the recursion points at
   * depends on whether the declaring file gets generated types of its own: if it
   * does, the self-reference is the type name the importing file will `import
   * type`; if it does not, there is no name to point at, and the recursion is
   * left as an `any` - widened to the index signature / array the getter
   * describes, so property access stays type-checked - with the inline copy
   * around it kept for whatever detail it still carries.
   */
  private resolveImportedSchemaType(
    importedSourceFile: SourceFile,
    originalName: string,
    localName: string,
    isImportable: boolean,
    inlineExternalTypes = false,
  ): Omit<RawSchemaType, "isExported"> {
    const inputType = this.resolveType(importedSourceFile, "__TempInput", inlineExternalTypes);
    const rawOutputType = this.resolveType(importedSourceFile, "__TempOutput", inlineExternalTypes);
    const outputType = withOutputFallback(rawOutputType, inputType);

    const getterFields = this.getterResolver
      .analyzeGetterFields(importedSourceFile, new Set([originalName]))
      .get(originalName);

    if (!getterFields || !this.getterResolver.hasSelfReferences(getterFields)) {
      return { input: inputType, output: outputType };
    }

    const resolveOptions = { collapseInlinedCopies: isImportable };
    const resolved = {
      input: this.getterResolver.resolveAnyTypes(
        inputType,
        getterFields,
        isImportable ? `${localName}Input` : "any",
        resolveOptions,
      ),
      output: this.getterResolver.resolveAnyTypes(
        outputType,
        getterFields,
        isImportable ? `${localName}Output` : "any",
        resolveOptions,
      ),
    };

    if (isImportable) {
      return { ...resolved, importedFrom: importedSourceFile.getFilePath(), originalName };
    }
    // No file will declare a name for this one, so what it printed is itself
    // the approximation a reference has to be inlined as.
    return { ...resolved, approximation: resolved };
  }

  /**
   * Removes the temporary input/output types that were injected during extraction.
   * Does not remove __Normalize (managed separately via ensureNormalizeType/cleanupNormalizeType).
   */
  private cleanupTemporaryTypes(sourceFile: SourceFile): void {
    for (const name of ["__TempInput", "__TempOutput"] as const) {
      const typeAlias = sourceFile.getTypeAlias(name);
      if (typeAlias) {
        typeAlias.remove();
      }
    }
  }

  /**
   * Escapes special characters in a string for use in a RegExp.
   */
  private escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  /**
   * Checks if a string is a valid TypeScript identifier.
   * Used to determine if a type name can be safely used in regex replacement.
   */
  private isValidIdentifier(str: string): boolean {
    return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(str);
  }

  /**
   * Checks whether an explicit annotation names a type declared in the same file.
   *
   * Only such a type is rewritten to the generated type name: a recursive schema
   * annotated `v.GenericSchema<Category>` prints as `Category`, which the
   * generated file has to spell as `CategoryInput` / `CategoryOutput`. A global
   * type (`v.GenericSchema<Function>`) must be left alone - rewriting it would
   * turn the declaration into a self-reference.
   */
  private isLocallyDeclaredType(sourceFile: SourceFile, typeName: string): boolean {
    if (!this.isValidIdentifier(typeName)) return false;
    return (
      sourceFile.getTypeAlias(typeName) !== undefined ||
      sourceFile.getInterface(typeName) !== undefined
    );
  }
}
