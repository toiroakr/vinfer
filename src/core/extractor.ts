import { Project, SourceFile, TypeFormatFlags, ts } from "ts-morph";
import { resolve as resolvePath } from "pathe";
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
    if ((char !== '"' && char !== "'" && char !== "`") || typeStr[index - 1] === "\\") {
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
 */
function absolutizeImportPaths(typeStr: string, sourceDir: string): string {
  if (!typeStr.includes('import("')) {
    return typeStr;
  }

  return typeStr.replace(/import\("([^"]+)"\)/g, (match, importPath: string) => {
    if (!importPath.startsWith(".")) {
      return match;
    }
    return `import("${resolvePath(sourceDir, importPath)}")`;
  });
}

/**
 * Falls back to a schema's printed input when TypeScript gave up on its
 * output, printing it as a bare `any`.
 */
function withOutputFallback(printedOutput: string, printedInput: string): string {
  return printedOutput === "any" ? printedInput : printedOutput;
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
      const cacheKey = `${importInfo.sourceFilePath}:${importInfo.originalName}:${localName}:${isImportable}`;
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
          const resolvedType = this.resolveType(sourceFile, "__TempExplicit");
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
        const rawInput = this.resolveType(sourceFile, "__TempInput");
        const printedOutput = this.resolveType(sourceFile, "__TempOutput");
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
  private resolveType(sourceFile: SourceFile, typeName: string): string {
    const typeAlias = sourceFile.getTypeAlias(typeName);
    if (!typeAlias) {
      throw new Error(`Failed to find type alias: ${typeName}`);
    }

    const type = typeAlias.getType();

    // Use TypeFormatFlags to get the fully expanded type without truncation
    // Don't use UseAliasDefinedOutsideCurrentScope to expand enum types
    const formatFlags = TypeFormatFlags.NoTruncation | TypeFormatFlags.InTypeAlias;

    let rawType = type.getText(typeAlias, formatFlags);

    // Remove trailing spaces from each line (ts-morph 27+ may add them)
    // Skip split/map/join for single-line types (most common case)
    if (rawType.includes("\n")) {
      rawType = rawType
        .split("\n")
        .map((line) => line.trimEnd())
        .join("\n");
    } else {
      rawType = rawType.trimEnd();
    }

    // Expand enum types: if the type is a single identifier, check if it's an enum
    if (/^[A-Z][a-zA-Z0-9]*$/.test(rawType)) {
      const enumDecl = sourceFile.getEnum(rawType);
      if (enumDecl) {
        // Extract enum values
        const members = enumDecl.getMembers();
        const values = members
          .map((member) => {
            const value = member.getValue();
            if (typeof value === "string") {
              return `"${value}"`;
            } else if (typeof value === "number") {
              return value.toString();
            }
            return null;
          })
          .filter(Boolean);

        if (values.length > 0) {
          rawType = values.join(" | ");
        }
      }
    }

    rawType = collapseRepeatedUndefined(rawType);
    rawType = absolutizeImportPaths(rawType, sourceFile.getDirectoryPath());

    // Reduce Valibot type references (Brand/Flavor) to their bare names so the
    // generated file can import them from "valibot" directly.
    return ValibotBindings.from(sourceFile).canonicalizeTypeNames(rawType);
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
  ): Omit<RawSchemaType, "isExported"> {
    const inputType = this.resolveType(importedSourceFile, "__TempInput");
    const rawOutputType = this.resolveType(importedSourceFile, "__TempOutput");
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
