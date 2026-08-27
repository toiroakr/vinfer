import { relative, dirname, basename, join, isAbsolute } from "pathe";
import { existsSync, realpathSync } from "fs";
import { VALIBOT_PRINTED_TYPE_NAMES } from "./valibot-bindings.js";
import { isEscaped } from "./string-scan.js";
import type {
  ExtractResult,
  MappedTypeName,
  DeclarationOptions,
  FieldDescription,
} from "./types.js";

/**
 * Options for formatting type output.
 */
export interface PrintOptions {
  /** Indentation string (default: "  ") */
  indent?: string;
  /** Whether to include the schema name in the output */
  includeSchemaName?: boolean;
}

/**
 * Formats the extraction result for console output.
 *
 * @param result - The extraction result containing input and output types
 * @param options - Formatting options
 * @returns Formatted string ready for console output
 */
export function formatResult(result: ExtractResult, options: PrintOptions = {}): string {
  const { indent = "  ", includeSchemaName = false } = options;
  const lines: string[] = [];

  if (includeSchemaName) {
    lines.push(`// Schema: ${result.schemaName}`);
    lines.push("");
  }

  lines.push("// input");
  lines.push(prettifyType(result.input, indent));
  lines.push("");
  lines.push("// output");
  lines.push(prettifyType(result.output, indent));

  return lines.join("\n");
}

/**
 * Prettifies a type string by formatting object types with proper indentation.
 *
 * @param typeStr - The type string to format
 * @param indent - The indentation string to use
 * @param descriptions - Optional field descriptions to insert as TSDoc comments
 * @param prefix - Current path prefix for nested objects
 * @returns The formatted type string
 */
function prettifyType(
  typeStr: string,
  indent: string,
  descriptions?: FieldDescription[],
  prefix: string = "",
): string {
  // If it's not an object type, return as-is
  if (!typeStr.startsWith("{") || !typeStr.endsWith("}")) {
    return typeStr;
  }

  const prettified = prettifyObjectType(typeStr, indent, descriptions, prefix);

  // Remove trailing spaces from each line
  return prettified
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n");
}

/**
 * Creates a TSDoc comment line.
 */
function createTsDocComment(description: string, indentStr: string): string {
  const lines = description.split("\n");
  if (lines.length === 1) {
    return `${indentStr}/** ${description} */\n`;
  }
  return (
    [`${indentStr}/**`, ...lines.map((line) => `${indentStr} * ${line}`), `${indentStr} */`].join(
      "\n",
    ) + "\n"
  );
}

/**
 * Gets description for a field path.
 */
function getFieldDescription(
  fieldName: string,
  prefix: string,
  descriptions?: FieldDescription[],
): string | undefined {
  if (!descriptions) {
    return undefined;
  }

  const path = prefix ? `${prefix}.${fieldName}` : fieldName;
  const desc = descriptions.find((d) => d.path === path);
  return desc?.description;
}

/**
 * Parser state for object type formatting.
 */
interface ParserState {
  result: string;
  depth: number;
  inString: boolean;
  stringChar: string;
  currentFieldName: string;
  capturingFieldName: boolean;
  /**
   * Last field name seen at each depth (keyed by depth). Recording per-depth
   * (rather than a single shared value) keeps a parent field's name intact
   * while its children are parsed, so sibling object braces at the same
   * depth (e.g. union members `{ a } | { b }`) still resolve to the parent
   * field's own path instead of inheriting the first sibling's last field.
   */
  lastFieldByDepth: Record<number, string>;
  /**
   * One entry per open "{", holding the field name that owns that brace ("" if
   * none, e.g. the root object or a union member sibling). Pushed/popped in
   * lockstep with braces so it always reflects the true nesting depth.
   */
  fieldNameStack: string[];
}

/**
 * Creates initial parser state.
 */
function createParserState(): ParserState {
  return {
    result: "",
    depth: 0,
    inString: false,
    stringChar: "",
    currentFieldName: "",
    capturingFieldName: false,
    lastFieldByDepth: {},
    fieldNameStack: [],
  };
}

/**
 * Updates string literal tracking state.
 * Returns true if currently inside a string literal.
 */
function updateStringState(
  state: ParserState,
  char: string,
  typeStr: string,
  index: number,
): boolean {
  if ((char === '"' || char === "'" || char === "`") && !isEscaped(typeStr, index)) {
    if (!state.inString) {
      state.inString = true;
      state.stringChar = char;
    } else if (char === state.stringChar) {
      state.inString = false;
      state.stringChar = "";
    }
  }
  return state.inString;
}

/**
 * Handles opening brace character.
 */
function handleOpenBrace(state: ParserState, indent: string): void {
  // The field owning this brace is whatever was last seen at the *parent*
  // depth - not overwritten by a sibling brace's own inner fields.
  const ownerField = state.lastFieldByDepth[state.depth] ?? "";
  state.depth++;
  state.result += "{\n" + indent.repeat(state.depth);
  state.fieldNameStack.push(ownerField);
  state.capturingFieldName = true;
  state.currentFieldName = "";
}

/**
 * Handles closing brace character.
 */
function handleCloseBrace(state: ParserState, indent: string): void {
  // Clear this depth's last-seen field so it can't leak into a sibling
  // brace opened afterward at the parent depth.
  delete state.lastFieldByDepth[state.depth];
  state.depth--;
  state.fieldNameStack.pop();
  state.result += "\n" + indent.repeat(state.depth) + "}";
}

/**
 * Handles colon character and inserts TSDoc comment if applicable.
 */
function handleColon(
  state: ParserState,
  indent: string,
  descriptions: FieldDescription[] | undefined,
  prefix: string,
): void {
  if (state.capturingFieldName && state.currentFieldName) {
    const cleanFieldName = state.currentFieldName.replace(/\?$/, "").trim();
    const scopePath = state.fieldNameStack.filter(Boolean).join(".");
    const currentPath = [prefix, scopePath].filter(Boolean).join(".");
    const desc = getFieldDescription(cleanFieldName, currentPath, descriptions);

    if (desc) {
      const lastNewlinePos = state.result.lastIndexOf("\n");
      const beforeField = state.result.substring(0, lastNewlinePos + 1);
      const fieldPart = state.result.substring(lastNewlinePos + 1);
      state.result = beforeField + createTsDocComment(desc, indent.repeat(state.depth)) + fieldPart;
    }
    // An index signature is not a path segment: a record's value schema carries
    // its descriptions at the very path of the field holding the record, so
    // recording "[x" here would put every nested description out of reach.
    state.lastFieldByDepth[state.depth] = cleanFieldName.startsWith("[") ? "" : cleanFieldName;
  }
  state.result += ":";
  state.capturingFieldName = false;
  state.currentFieldName = "";
}

/**
 * Handles semicolon character.
 */
function handleSemicolon(state: ParserState, indent: string, typeStr: string, index: number): void {
  const remaining = typeStr.slice(index + 1).trim();
  if (remaining.startsWith("}")) {
    state.result += ";";
  } else {
    state.result += ";\n" + indent.repeat(state.depth);
    state.capturingFieldName = true;
    state.currentFieldName = "";
  }
}

/**
 * Handles space character, skipping extra spaces after newlines.
 */
function handleSpace(state: ParserState, indent: string): boolean {
  if (
    state.result.endsWith("\n" + indent.repeat(state.depth)) ||
    state.result.endsWith("{\n" + indent.repeat(state.depth))
  ) {
    return true; // Skip this space
  }
  state.result += " ";
  if (state.capturingFieldName) {
    state.currentFieldName += " ";
  }
  return false;
}

/**
 * Handles default character.
 */
function handleDefaultChar(state: ParserState, char: string): void {
  state.result += char;
  if (state.capturingFieldName) {
    state.currentFieldName += char;
  }
}

/**
 * Handles character inside a string literal.
 */
function handleStringChar(state: ParserState, char: string): void {
  state.result += char;
  if (state.capturingFieldName) {
    state.currentFieldName += char;
  }
}

/**
 * Formats an object type string with proper indentation and line breaks.
 */
function prettifyObjectType(
  typeStr: string,
  indent: string,
  descriptions?: FieldDescription[],
  prefix: string = "",
): string {
  const state = createParserState();

  for (let i = 0; i < typeStr.length; i++) {
    const char = typeStr[i];

    const inString = updateStringState(state, char, typeStr, i);

    if (inString) {
      handleStringChar(state, char);
      continue;
    }

    switch (char) {
      case "{":
        handleOpenBrace(state, indent);
        break;
      case "}":
        handleCloseBrace(state, indent);
        break;
      case ":":
        handleColon(state, indent, descriptions, prefix);
        break;
      case ";":
        handleSemicolon(state, indent, typeStr, i);
        break;
      case " ":
        handleSpace(state, indent);
        break;
      default:
        handleDefaultChar(state, char);
    }
  }

  return state.result;
}

/**
 * Formats the extraction result as input type only.
 */
export function formatInputOnly(result: ExtractResult, options: PrintOptions = {}): string {
  const { indent = "  " } = options;
  return prettifyType(result.input, indent);
}

/**
 * Formats the extraction result as output type only.
 */
export function formatOutputOnly(result: ExtractResult, options: PrintOptions = {}): string {
  const { indent = "  " } = options;
  return prettifyType(result.output, indent);
}

/**
 * Formats a single extraction result as TypeScript type declaration(s).
 *
 * @param result - The extraction result
 * @param typeName - The mapped type names
 * @param options - Declaration options
 * @returns TypeScript type declaration string
 */
export function formatAsDeclaration(
  result: ExtractResult,
  typeName: MappedTypeName,
  options: DeclarationOptions = {},
): string {
  const { inputOnly, outputOnly, mergeSame, brandStrategy } = options;
  const lines: string[] = [];
  const indent = "  ";

  const rawInput =
    brandStrategy === "local-symbol" ? localizeBrandMarkers(result.input) : result.input;
  const rawOutput =
    brandStrategy === "local-symbol" ? localizeBrandMarkers(result.output) : result.output;
  const inputFormatted = prettifyType(rawInput, indent, result.fieldDescriptions);
  const outputFormatted = prettifyType(rawOutput, indent, result.fieldDescriptions);

  // Schema-level TSDoc comment
  const schemaComment = result.description
    ? `/**\n${result.description
        .split("\n")
        .map((line) => ` * ${line}`)
        .join("\n")}\n */\n`
    : "";

  // Only export if the original schema was exported
  const exportKeyword = result.isExported ? "export " : "";

  // If mergeSame is enabled and types are identical
  if (mergeSame && result.input === result.output) {
    lines.push(`${schemaComment}${exportKeyword}type ${typeName.unifiedName} = ${inputFormatted};`);
    // Emit aliases for input/output names that differ from the unified name
    if (typeName.inputName !== typeName.unifiedName) {
      lines.push(`${exportKeyword}type ${typeName.inputName} = ${typeName.unifiedName};`);
    }
    if (
      typeName.outputName !== typeName.unifiedName &&
      typeName.outputName !== typeName.inputName
    ) {
      lines.push(`${exportKeyword}type ${typeName.outputName} = ${typeName.unifiedName};`);
    }
    return lines.join("\n");
  }

  // Input type
  if (!outputOnly) {
    lines.push(`${schemaComment}${exportKeyword}type ${typeName.inputName} = ${inputFormatted};`);
  }

  // Output type
  if (!inputOnly) {
    if (lines.length > 0) {
      lines.push("");
    }
    // Only add schema comment to output if input was not added
    const outputComment = outputOnly ? schemaComment : "";
    lines.push(`${outputComment}${exportKeyword}type ${typeName.outputName} = ${outputFormatted};`);
  }

  return lines.join("\n");
}

/**
 * Formats multiple extraction results as TypeScript type declarations.
 *
 * @param results - Array of extraction results
 * @param mapName - Function to map schema name to type names
 * @param options - Declaration options
 * @returns TypeScript type declarations string
 */
/**
 * Escapes special characters in a string for use in a RegExp.
 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Matches the empty position just before or after a run of identifier
 * characters, without requiring one side to actually be an identifier
 * character - `\b` is defined in terms of `\w` (`[A-Za-z0-9_]`), which
 * excludes `$` (legal at the start of a JS/TS identifier) and every Unicode
 * letter, so a name like `$NodeInput` or a schema named with accented
 * characters never matches at all under `\b`.
 */
const NOT_BEFORE_IDENTIFIER = "(?<![\\p{ID_Continue}$])";
const NOT_AFTER_IDENTIFIER = "(?![\\p{ID_Continue}$])";

/**
 * An explicit `v.GenericSchema<T>` annotation prints `T` verbatim, which can
 * carry text that happens to spell out another schema's generated name
 * without being a reference to it at all:
 *
 * - `typeof Name` is a type query naming `Name`'s own value, not its type -
 *   substituting the generated type name there (`typeof GeneratedName`)
 *   only happens to parse when that generated name is itself a value in
 *   scope, and is wrong regardless: the printer meant the *original*
 *   value, not whatever this pass renamed it to. `Name` here can itself be
 *   printed as `import("...").Name` when it isn't otherwise in scope, so
 *   the lookbehind covers both `typeof Name` and `typeof import("...").Name`.
 * - `Name(): T` is a method signature - `Name` here names the method, not
 *   a type, and substituting it corrupts the signature into
 *   `<expanded>(): T`.
 *
 * Both are excluded from every identifier substitution in this file, not
 * just the schema-name ones, since the same T can flow into the recursion
 * dependency lookups and `mergeSame` unification below.
 */
const NOT_TYPEOF_OPERAND = "(?<!typeof\\s+(?:import\\([^)]*\\)\\.)?)";
const NOT_METHOD_NAME = "(?!\\s*\\()";

/**
 * Builds a pattern matching `name` as a whole identifier - see
 * `NOT_BEFORE_IDENTIFIER` for why this exists instead of `\b`, and
 * `NOT_TYPEOF_OPERAND`/`NOT_METHOD_NAME` for the two syntax positions this
 * additionally refuses to match in. Requires the `u` flag, so it is
 * included alongside whatever `flags` the caller passes - unless already
 * present, since `RegExp` rejects a flags string with a repeated flag
 * (e.g. `"guu"`).
 */
function identifierPattern(name: string, flags = ""): RegExp {
  return new RegExp(
    `${NOT_TYPEOF_OPERAND}${NOT_BEFORE_IDENTIFIER}${escapeRegExp(name)}${NOT_AFTER_IDENTIFIER}${NOT_METHOD_NAME}`,
    flags.includes("u") ? flags : `${flags}u`,
  );
}

export function formatMultipleAsDeclarations(
  results: ExtractResult[],
  mapName: (schemaName: string) => MappedTypeName,
  options: DeclarationOptions = {},
): string {
  // Build a map of schema names to their mapped type names. Schemas declared
  // here are joined by those imported from another generated file, whose names
  // this file references without declaring them.
  const typeNameMap = new Map<string, MappedTypeName>();
  for (const result of results) {
    if (!result.isExported && !result.importedFrom) continue;
    if (typeNameMap.has(result.schemaName)) continue;
    typeNameMap.set(result.schemaName, mapName(result.schemaName));
  }

  // Pass 1: Replace schema references with correct type names
  let fixedResults = results.map((result) => {
    let input = result.input;
    let output = result.output;

    for (const [schemaName, mappedName] of typeNameMap) {
      const inputPattern = identifierPattern(`${schemaName}Input`, "g");
      input = input.replace(inputPattern, mappedName.inputName);

      const outputPattern = identifierPattern(`${schemaName}Output`, "g");
      output = output.replace(outputPattern, mappedName.outputName);
    }

    return { ...result, input, output };
  });

  // Pass 2: When mergeSame is enabled, determine which schemas can be merged and
  // replace input/output-specific names with unified names.
  // Uses topological sort to process schemas in dependency order so that
  // transitive merges (A → B → C) are resolved in a single pass.
  if (options.mergeSame) {
    // Build dependency graph: which schemas does each schema reference?
    const deps = new Map<string, Set<string>>();
    for (const result of fixedResults) {
      const refSet = new Set<string>();
      for (const [, mapped] of typeNameMap) {
        if (mapped.inputName === mapped.unifiedName) continue;
        const inputRe = identifierPattern(mapped.inputName);
        const outputRe = identifierPattern(mapped.outputName);
        if (inputRe.test(result.input) || outputRe.test(result.output)) {
          refSet.add(mapped.inputName);
        }
      }
      deps.set(result.schemaName, refSet);
    }

    // Map inputName back to schemaName for dependency lookup
    const inputNameToSchema = new Map<string, string>();
    for (const [schemaName, mapped] of typeNameMap) {
      inputNameToSchema.set(mapped.inputName, schemaName);
    }

    // Topological sort (Kahn's algorithm)
    const inDegree = new Map<string, number>();
    const graph = new Map<string, string[]>();
    for (const result of fixedResults) {
      inDegree.set(result.schemaName, 0);
      graph.set(result.schemaName, []);
    }
    for (const [schemaName, refInputNames] of deps) {
      let count = 0;
      for (const refInputName of refInputNames) {
        const depSchema = inputNameToSchema.get(refInputName);
        // A recursive schema depends on itself, but its own merge is decided by
        // unifying those self-references - not by waiting for another schema -
        // so the self-edge must not keep it out of the topological order.
        if (depSchema && depSchema !== schemaName && graph.has(depSchema)) {
          graph.get(depSchema)!.push(schemaName);
          count++;
        }
      }
      inDegree.set(schemaName, count);
    }
    const order: string[] = [];
    const queue = [...inDegree.entries()].filter(([, d]) => d === 0).map(([n]) => n);
    while (queue.length > 0) {
      const node = queue.shift()!;
      order.push(node);
      for (const next of graph.get(node) ?? []) {
        const d = inDegree.get(next)! - 1;
        inDegree.set(next, d);
        if (d === 0) queue.push(next);
      }
    }
    // Append any remaining (cyclic) schemas at the end
    for (const result of fixedResults) {
      if (!order.includes(result.schemaName)) order.push(result.schemaName);
    }

    // Process in topological order, accumulating merged schemas. A schema can
    // appear twice - once as this file's own declaration, once as the imported
    // copy a sibling file brought along - and both describe the same types, so
    // the pass runs over one entry per name.
    const mergedSet = new Set<string>();
    const unifiedTypes = new Map<string, { input: string; output: string }>();
    for (const result of fixedResults) {
      if (!unifiedTypes.has(result.schemaName)) {
        unifiedTypes.set(result.schemaName, { input: result.input, output: result.output });
      }
    }

    for (const schemaName of order) {
      const result = unifiedTypes.get(schemaName);
      if (!result) continue;

      let { input, output } = result;

      // Apply unifications from already-determined merged schemas
      for (const mergedSchema of mergedSet) {
        const mapped = typeNameMap.get(mergedSchema);
        if (!mapped) continue;
        input = input.replace(identifierPattern(mapped.inputName, "g"), mapped.unifiedName);
        output = output.replace(identifierPattern(mapped.outputName, "g"), mapped.unifiedName);
      }

      const mapped = typeNameMap.get(schemaName);
      const mergeable = mapped && mapped.inputName !== mapped.unifiedName;

      // A recursive schema spells its own name inside itself, once per
      // direction. Those two names describe the same shape whenever everything
      // around them does, so they are unified before the comparison - otherwise
      // no recursive schema could ever merge.
      if (mergeable) {
        const selfInput = input.replace(
          identifierPattern(mapped.inputName, "g"),
          mapped.unifiedName,
        );
        const selfOutput = output.replace(
          identifierPattern(mapped.outputName, "g"),
          mapped.unifiedName,
        );
        if (selfInput === selfOutput) {
          input = selfInput;
          output = selfOutput;
        }
      }

      unifiedTypes.set(schemaName, { input, output });

      // Check if this schema is now mergeable
      if (input === output && mergeable) {
        mergedSet.add(schemaName);
      }
    }

    // Take only the unified types back, so each entry keeps its own export
    // status and descriptions.
    fixedResults = fixedResults.map((r) => ({ ...r, ...unifiedTypes.get(r.schemaName) }));
  }

  const declarations: string[] = [];

  // Only generate declarations for exported schemas
  for (const result of fixedResults) {
    if (!result.isExported) {
      continue;
    }
    const typeName = mapName(result.schemaName);
    const declaration = formatAsDeclaration(result, typeName, options);
    declarations.push(declaration);
  }

  return declarations.join("\n\n");
}

/**
 * Collects the Valibot type helpers referenced by the extracted types.
 *
 * Branded and flavored primitives print as `string & Brand<"UserId">`, so the
 * generated file has to import `Brand` / `Flavor` from "valibot".
 */
function usedValibotTypeNames(results: ExtractResult[]): string[] {
  return VALIBOT_PRINTED_TYPE_NAMES.filter((name) => {
    const pattern = new RegExp(`${NOT_BEFORE_IDENTIFIER}${escapeRegExp(name)}<`, "u");
    return results.some((r) => pattern.test(r.input) || pattern.test(r.output));
  });
}

/**
 * Local-symbol marker names for the `"local-symbol"` brand strategy. A
 * `declare const __brand: unique symbol;` / `declare const __flavor: unique
 * symbol;` is emitted once per generated file (only the ones actually used)
 * and reused by every branded/flavored type it declares - the nominal
 * distinction between tags comes from the tag's own string literal, not from
 * the symbol's identity, the same way Valibot's own `BrandSymbol` /
 * `FlavorSymbol` markers work.
 *
 * Because each generated file declares its own `unique symbol`, two
 * same-tag branded types printed into *separate* output files (e.g. one
 * per input file under `--outDir`) are not assignable to each other, even
 * though their printed text looks identical - TypeScript's `unique symbol`
 * ties identity to the declaration, not the name. `--brand-strategy
 * valibot-import`'s `Brand`/`Flavor` don't have this limitation, since
 * every file imports the same marker from valibot. A type referenced
 * through `crossFileImportLines` (an `import type` of another generated
 * file's own type) is unaffected either way.
 */
const LOCAL_BRAND_SYMBOL = "__brand";
const LOCAL_FLAVOR_SYMBOL = "__flavor";

/**
 * Maps each printed marker name to the local symbol name that replaces it,
 * and to whether the printed property is optional - `Flavor<TName>` is
 * `{ [FlavorSymbol]?: ... }` (optional) in Valibot, unlike `Brand<TName>`'s
 * required property, and the local-symbol replacement mirrors that.
 */
const BRAND_MARKERS: ReadonlyArray<{
  name: "Brand" | "Flavor";
  symbol: string;
  optional: boolean;
}> = [
  { name: "Brand", symbol: LOCAL_BRAND_SYMBOL, optional: false },
  { name: "Flavor", symbol: LOCAL_FLAVOR_SYMBOL, optional: true },
];

/** Matches a valid TypeScript identifier character. */
const IDENTIFIER_CHAR = /[\p{ID_Continue}$]/u;

/**
 * Whether `ch` is a valid TypeScript identifier character, for the
 * word-boundary check before a `Brand<`/`Flavor<` marker - a printed type
 * ending an identifier in `...Foo$Brand<...>` must not be mistaken for a
 * real marker.
 */
function isIdentifierChar(ch: string | undefined): boolean {
  return ch !== undefined && IDENTIFIER_CHAR.test(ch);
}

/**
 * Finds which real `Brand<`/`Flavor<` marker (if any) starts at `index`,
 * string-literal- and word-boundary-aware so a schema whose own literal
 * value happens to contain the text `Brand<` (e.g. `v.literal("Brand<Fake>")`)
 * or ends an identifier in `...Brand<...>` is never mistaken for one.
 */
function matchBrandMarkerAt(
  typeStr: string,
  index: number,
): { name: "Brand" | "Flavor"; symbol: string; optional: boolean } | undefined {
  if (isIdentifierChar(typeStr[index - 1])) return undefined;
  for (const marker of BRAND_MARKERS) {
    if (typeStr.startsWith(`${marker.name}<`, index)) return marker;
  }
  return undefined;
}

/**
 * Finds the `>` that closes a `Brand<...>`/`Flavor<...>` marker's tag,
 * skipping over a `>` that occurs inside the tag's own string literal (e.g.
 * a tag like `"a>b"`).
 */
function findMarkerTagEnd(typeStr: string, tagStart: number): number {
  let depth = 0;
  let inString = false;
  let stringChar = "";

  for (let i = tagStart; i < typeStr.length; i++) {
    const char = typeStr[i];

    if ((char === '"' || char === "'" || char === "`") && !isEscaped(typeStr, i)) {
      if (!inString) {
        inString = true;
        stringChar = char;
      } else if (char === stringChar) {
        inString = false;
      }
      continue;
    }

    if (inString) continue;

    if (char === "<") {
      depth++;
    } else if (char === ">") {
      if (depth === 0) return i;
      depth--;
    }
  }

  return typeStr.length;
}

/**
 * One real `Brand<Tag>`/`Flavor<Tag>` marker found by `scanForBrandMarkers`,
 * with its position and the boundaries of its tag.
 */
interface BrandMarkerMatch {
  marker: { name: "Brand" | "Flavor"; symbol: string; optional: boolean };
  start: number;
  tagStart: number;
  tagEnd: number;
}

/**
 * Scans a printed type string for real `Brand<`/`Flavor<` markers, yielding
 * each one's position and tag boundaries. String-literal and word-boundary
 * aware, so a schema whose own literal type happens to contain the text
 * `Brand<` (e.g. `v.literal("Brand<Fake>")`, printed as the string literal
 * type `"Brand<Fake>"`) or ends an identifier in `...Brand<...>` never
 * yields a match. Shared by `localizeBrandMarkers` (which rewrites each
 * match) and `scanBrandMarkers` (which only records which marker names
 * appear).
 */
function* scanForBrandMarkers(typeStr: string): Generator<BrandMarkerMatch> {
  let inString = false;
  let stringChar = "";
  let cursor = 0;

  while (cursor < typeStr.length) {
    const char = typeStr[cursor];

    if ((char === '"' || char === "'" || char === "`") && !isEscaped(typeStr, cursor)) {
      if (!inString) {
        inString = true;
        stringChar = char;
      } else if (char === stringChar) {
        inString = false;
      }
      cursor++;
      continue;
    }

    if (!inString) {
      const marker = matchBrandMarkerAt(typeStr, cursor);
      if (marker) {
        const tagStart = cursor + marker.name.length + 1; // +1 for "<"
        const tagEnd = findMarkerTagEnd(typeStr, tagStart);
        yield { marker, start: cursor, tagStart, tagEnd };
        cursor = tagEnd + 1;
        continue;
      }
    }

    cursor++;
  }
}

/**
 * Rewrites every printed `Brand<Tag>` / `Flavor<Tag>` marker to a
 * self-contained symbol-keyed property, so the output never needs to import
 * Valibot's `Brand` / `Flavor`.
 */
function localizeBrandMarkers(typeStr: string): string {
  let result = "";
  let cursor = 0;

  for (const { marker, start, tagStart, tagEnd } of scanForBrandMarkers(typeStr)) {
    result += typeStr.slice(cursor, start);
    const tag = typeStr.slice(tagStart, tagEnd);
    const optionalMark = marker.optional ? "?" : "";
    result += `{ readonly [${marker.symbol}]${optionalMark}: ${tag} }`;
    cursor = tagEnd + 1;
  }
  result += typeStr.slice(cursor);

  return result;
}

/**
 * Finds which real `Brand<`/`Flavor<` markers (if any) a printed type
 * contains, as opposed to a plain string literal that merely contains that
 * text - used to decide which `declare const __brand`/`__flavor` lines are
 * actually needed under the `"local-symbol"` strategy.
 */
function scanBrandMarkers(typeStr: string): Set<"Brand" | "Flavor"> {
  const found = new Set<"Brand" | "Flavor">();
  for (const { marker } of scanForBrandMarkers(typeStr)) found.add(marker.name);
  return found;
}

/**
 * Finds which real `Brand<`/`Flavor<` markers show up across every result's
 * *emitted* type(s). Only scans exported results (generateDeclarationFile
 * skips non-exported ones), and only the sides that are actually emitted
 * under `inputOnly`/`outputOnly`/`mergeSame`.
 */
function usedBrandMarkers(
  results: ExtractResult[],
  options: DeclarationOptions = {},
): Set<"Brand" | "Flavor"> {
  const { inputOnly, outputOnly, mergeSame } = options;
  const found = new Set<"Brand" | "Flavor">();

  for (const r of results) {
    if (!r.isExported) continue;

    const texts: string[] = [];
    if (mergeSame && r.input === r.output) {
      texts.push(r.input);
    } else {
      if (!outputOnly) texts.push(r.input);
      if (!inputOnly) texts.push(r.output);
    }

    for (const text of texts) {
      for (const name of scanBrandMarkers(text)) found.add(name);
    }
  }

  return found;
}

/**
 * Generates a complete TypeScript declaration file content.
 *
 * @param results - Array of extraction results
 * @param mapName - Function to map schema name to type names
 * @param options - Declaration options
 * @returns Complete .d.ts or .ts file content
 */
export function generateDeclarationFile(
  results: ExtractResult[],
  mapName: (schemaName: string) => MappedTypeName,
  options: DeclarationOptions = {},
): string {
  const lines: string[] = [];
  const declarations = formatMultipleAsDeclarations(results, mapName, options);

  // Add header comment
  lines.push("// Generated by vinfer - Do not edit manually");
  lines.push("");

  if (options.brandStrategy === "local-symbol") {
    // Add a local brand/flavor marker declaration instead of importing
    // Brand/Flavor from valibot
    const markers = usedBrandMarkers(results, options);
    if (markers.has("Brand")) {
      lines.push(`declare const ${LOCAL_BRAND_SYMBOL}: unique symbol;`);
    }
    if (markers.has("Flavor")) {
      lines.push(`declare const ${LOCAL_FLAVOR_SYMBOL}: unique symbol;`);
    }
    if (markers.size > 0) {
      lines.push("");
    }
  } else {
    // Import the Valibot type helpers that show up in the generated types
    const valibotTypeNames = usedValibotTypeNames(results);
    if (valibotTypeNames.length > 0) {
      lines.push(`import type { ${valibotTypeNames.join(", ")} } from "valibot";`);
      lines.push("");
    }
  }

  // Import the types this file references from other generated files
  const crossFileImports = crossFileImportLines(results, mapName, options, declarations);
  if (crossFileImports.length > 0) {
    lines.push(...crossFileImports);
    lines.push("");
  }

  // Add type declarations
  lines.push(declarations);
  lines.push("");

  return lines.join("\n");
}

/**
 * Builds the `import type` lines for schemas whose types another generated file
 * declares.
 *
 * Which of a schema's names are needed depends on how the declarations came out
 * - `mergeSame` collapses a reference to the unified name - so the names are
 * read back out of the rendered declarations rather than predicted.
 *
 * A schema imported under an alias (`import { X as Y }`) is spelled as `Y`
 * throughout this file's own declarations, but the declaring file names its
 * generated types after `X`, not `Y` - so the two are bridged with `as` where
 * they differ.
 */
function crossFileImportLines(
  results: ExtractResult[],
  mapName: (schemaName: string) => MappedTypeName,
  options: DeclarationOptions,
  declarations: string,
): string[] {
  const { importSources } = options;
  if (!importSources || importSources.size === 0) {
    return [];
  }

  const namesByModule = new Map<string, Map<string, string>>();

  for (const result of results) {
    if (!result.importedFrom) continue;

    const moduleSpecifier = importSources.get(result.schemaName);
    if (!moduleSpecifier) continue;

    const localMapped = mapName(result.schemaName);
    const targetMapped = mapName(result.originalName ?? result.schemaName);
    const namePairs: [local: string, target: string][] = [
      [localMapped.unifiedName, targetMapped.unifiedName],
      [localMapped.inputName, targetMapped.inputName],
      [localMapped.outputName, targetMapped.outputName],
    ];

    let names = namesByModule.get(moduleSpecifier);
    if (!names) {
      names = new Map<string, string>();
      namesByModule.set(moduleSpecifier, names);
    }

    for (const [localName, targetName] of namePairs) {
      if (!identifierPattern(localName).test(declarations)) continue;
      names.set(localName, targetName);
    }
  }

  return (
    [...namesByModule]
      // A cross-file schema that this file imports but never actually
      // references (dead import, or its only reference got filtered out)
      // leaves its module's name set empty - and `import type { }` is not
      // valid TypeScript, so that module contributes no line at all.
      .filter(([, names]) => names.size > 0)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([moduleSpecifier, names]) => {
        const specifiers = [...names]
          .map(([localName, targetName]) =>
            targetName === localName ? targetName : `${targetName} as ${localName}`,
          )
          .sort();
        return `import type { ${specifiers.join(", ")} } from "${moduleSpecifier}";`;
      })
  );
}

/**
 * Resolves `path` to its real, symlink-free form. `path` itself may not
 * exist yet (an output directory that hasn't been created), so this walks up
 * to the nearest existing ancestor, realpath's that, and re-appends the
 * not-yet-existing part unresolved.
 */
function realpathExisting(path: string): string {
  if (existsSync(path)) {
    return realpathSync(path);
  }
  const parent = dirname(path);
  if (parent === path) {
    return path;
  }
  return join(realpathExisting(parent), basename(path));
}

/**
 * Converts absolute `import("...")` paths in generated type content to relative paths.
 *
 * TypeScript's type printer may emit absolute file paths in `import()` type syntax
 * (e.g., `import("/Users/foo/bar/src/types/plugin").SomeType`).
 * These must be converted to relative paths so the output is portable across machines.
 *
 * @param content - The generated file content
 * @param outputFilePath - Absolute path to the output file
 * @returns Content with absolute import paths replaced by relative paths
 */
export function relativizeImportPaths(content: string, outputFilePath: string): string {
  // Realpath'd so a symlinked output directory (e.g. one built from an
  // absolute path the caller passed through unresolved) lines up with the
  // already-realpath'd absolute import paths extractor.ts produces - both
  // must be resolved from the same symlink base for `relative()` below to
  // compute a short, correct path instead of walking up through the root.
  const outputDir = realpathExisting(dirname(outputFilePath));

  return content.replace(/import\("([^"]+)"\)/g, (_match, importPath: string) => {
    if (!isAbsolute(importPath)) {
      return _match;
    }
    let rel = relative(outputDir, importPath);
    if (!rel.startsWith(".")) {
      rel = "./" + rel;
    }
    return `import("${rel}")`;
  });
}
