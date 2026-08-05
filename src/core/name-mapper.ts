import type { NameMappingOptions, MappedTypeName } from "./types.js";

/**
 * Default options for name mapping.
 */
const DEFAULT_OPTIONS: Required<Omit<NameMappingOptions, "customMap" | "removeSuffix">> = {
  inputSuffix: "Input",
  outputSuffix: "Output",
};

/**
 * Maps Valibot schema names to TypeScript type names.
 */
export class NameMapper {
  private options: NameMappingOptions;

  /**
   * Creates a new NameMapper instance.
   *
   * @param options - Name mapping options
   */
  constructor(options: NameMappingOptions = {}) {
    this.options = {
      ...DEFAULT_OPTIONS,
      ...options,
    };
  }

  /**
   * Maps a schema name to input, output, and unified type names.
   *
   * @param schemaName - The original schema name (e.g., "UserSchema")
   * @returns The mapped type names
   *
   * @example
   * ```typescript
   * const mapper = new NameMapper({ removeSuffix: "Schema" });
   * mapper.map("UserSchema");
   * // Returns: { originalName: "UserSchema", inputName: "UserInput", outputName: "UserOutput", unifiedName: "User" }
   * ```
   */
  map(schemaName: string): MappedTypeName {
    // Check for custom mapping first
    if (this.options.customMap?.[schemaName]) {
      const baseName = this.options.customMap[schemaName];
      return this.createMappedNames(schemaName, baseName);
    }

    // Remove suffix if specified
    let baseName = schemaName;
    if (this.options.removeSuffix && schemaName.endsWith(this.options.removeSuffix)) {
      baseName = schemaName.slice(0, -this.options.removeSuffix.length);
    }

    return this.createMappedNames(schemaName, baseName);
  }

  /**
   * Creates the full mapped names object from a base name.
   */
  private createMappedNames(originalName: string, baseName: string): MappedTypeName {
    const inputSuffix = this.options.inputSuffix ?? DEFAULT_OPTIONS.inputSuffix;
    const outputSuffix = this.options.outputSuffix ?? DEFAULT_OPTIONS.outputSuffix;

    return {
      originalName,
      inputName: baseName + inputSuffix,
      outputName: baseName + outputSuffix,
      unifiedName: baseName,
    };
  }

  /**
   * Creates a mapping function for use with formatMultipleAsDeclarations.
   *
   * @returns A function that maps schema names to type names
   */
  createMapFunction(): (schemaName: string) => MappedTypeName {
    return this.map.bind(this);
  }
}

/**
 * Creates a simple name mapper with the given options.
 *
 * @param options - Name mapping options
 * @returns A function that maps schema names to type names
 */
export function createNameMapper(
  options: NameMappingOptions = {},
): (schemaName: string) => MappedTypeName {
  const mapper = new NameMapper(options);
  return (schemaName: string) => mapper.map(schemaName);
}
