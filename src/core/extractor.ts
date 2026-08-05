import { Project, SourceFile, TypeFormatFlags, ts } from "ts-morph";
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
 * Extracts input and output types from Valibot schemas using TypeScript Compiler API.
 */
export class ValibotTypeExtractor {
  private project: Project;
  private schemaDetector: SchemaDetector;
  private getterResolver: GetterResolver;
  private referenceAnalyzer: SchemaReferenceAnalyzer;
  private importResolver: ImportResolver;
  private importedSchemaCache = new Map<string, { input: string; output: string }>();

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
  extractAll(filePath: string): ExtractResult[] {
    const sourceFile = this.getOrAddSourceFile(filePath);
    const schemas = this.schemaDetector.detectExportedSchemas(sourceFile);

    return this.extractMultipleFromSourceFile(sourceFile, schemas);
  }

  /**
   * Extracts types from specific schemas in a file.
   *
   * @param filePath - Path to the TypeScript file
   * @param schemaNames - Names of schemas to extract
   * @returns Array of extraction results
   */
  extractMultiple(filePath: string, schemaNames: string[]): ExtractResult[] {
    const sourceFile = this.getOrAddSourceFile(filePath);
    const allSchemas = this.schemaDetector.detectExportedSchemas(sourceFile);
    const schemas = schemaNames.map((name) => {
      const found = allSchemas.find((s) => s.name === name);
      return found || { name, isExported: true, line: 0 };
    });

    return this.extractMultipleFromSourceFile(sourceFile, schemas);
  }

  /**
   * Extracts types from all exported schemas and returns file-level result.
   *
   * @param filePath - Path to the TypeScript file
   * @returns File extraction result with all schemas
   */
  extractFile(filePath: string): FileExtractResult {
    return {
      filePath,
      schemas: this.extractAll(filePath),
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
    const rawTypes = new Map<string, { input: string; output: string; isExported: boolean }>();

    // Inject __Normalize once for the main source file
    this.ensureNormalizeType(sourceFile);

    // Extract types from imported schemas first
    for (const [localName, importInfo] of importedSchemas) {
      if (!importInfo.resolved) continue;

      // Check cache for previously extracted imported schemas
      const cacheKey = `${importInfo.sourceFilePath}:${importInfo.originalName}`;
      const cached = this.importedSchemaCache.get(cacheKey);
      if (cached) {
        rawTypes.set(localName, {
          input: cached.input,
          output: cached.output,
          isExported: false,
        });
        continue;
      }

      const importedSourceFile = this.project.getSourceFile(importInfo.sourceFilePath);
      if (!importedSourceFile) continue;

      this.ensureNormalizeType(importedSourceFile);
      try {
        this.injectTemporaryTypes(importedSourceFile, importInfo.originalName);
        const inputType = this.resolveType(importedSourceFile, "__TempInput");
        const outputType = this.resolveType(importedSourceFile, "__TempOutput");

        // Cache the result
        this.importedSchemaCache.set(cacheKey, { input: inputType, output: outputType });

        // Use local name as the key (how it's referenced in current file)
        rawTypes.set(localName, {
          input: inputType,
          output: outputType,
          isExported: false, // Imported schemas won't be re-exported
        });
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
        let inputType = this.resolveType(sourceFile, "__TempInput");
        let outputType = this.resolveType(sourceFile, "__TempOutput");

        // Resolve getter-based self-references
        const getterFields = getterFieldMap.get(schemaName);
        if (getterFields && this.getterResolver.hasSelfReferences(getterFields)) {
          const inputTypeName = `${schemaName}Input`;
          const outputTypeName = `${schemaName}Output`;
          const originalInputType = inputType;

          inputType = this.getterResolver.resolveAnyTypes(inputType, getterFields, inputTypeName);

          if (outputType === "any") {
            outputType = this.getterResolver.resolveAnyTypes(
              originalInputType,
              getterFields,
              outputTypeName,
            );
          } else {
            outputType = this.getterResolver.resolveAnyTypes(
              outputType,
              getterFields,
              outputTypeName,
            );
          }
        }

        rawTypes.set(schemaName, { input: inputType, output: outputType, isExported });
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
        if (!refRaw?.isExported) continue;

        input = this.replaceSchemaReference(input, ref, refRaw.input, `${ref.refSchema}Input`);
        output = this.replaceSchemaReference(output, ref, refRaw.output, `${ref.refSchema}Output`);
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

    // Reduce Valibot type references (Brand/Flavor) to their bare names so the
    // generated file can import them from "valibot" directly.
    return ValibotBindings.from(sourceFile).canonicalizeTypeNames(rawType);
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
