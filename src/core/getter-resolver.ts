import { SourceFile, SyntaxKind, Node } from "ts-morph";
import { ValibotBindings } from "./valibot-bindings.js";
import { analyzeSchemaExpression, type SchemaExpressionRef } from "./schema-expression.js";
import { isEscaped } from "./string-scan.js";

/**
 * Information about a getter field in a `v.object()` schema.
 */
export interface GetterFieldInfo extends SchemaExpressionRef {
  /** Whether this is a self-reference */
  isSelfRef: boolean;
}

/**
 * Mapping of schema name to its getter field information.
 */
export type GetterFieldMap = Map<string, Map<string, GetterFieldInfo>>;

/**
 * Detects and resolves getter-based recursive patterns in Valibot schemas.
 */
export class GetterResolver {
  /**
   * Analyzes a source file to find getter field mappings.
   *
   * @param sourceFile - The ts-morph SourceFile to analyze
   * @param schemaNames - When given, only these schemas are analyzed
   * @returns Map of schema name to field info
   */
  analyzeGetterFields(sourceFile: SourceFile, schemaNames?: Set<string>): GetterFieldMap {
    const result: GetterFieldMap = new Map();
    const bindings = ValibotBindings.from(sourceFile);

    const statements = sourceFile.getVariableStatements();
    for (const stmt of statements) {
      for (const decl of stmt.getDeclarations()) {
        const schemaName = decl.getName();
        if (schemaNames && !schemaNames.has(schemaName)) continue;

        const init = decl.getInitializer();
        if (!init) continue;

        const fieldMap = this.extractGetterFieldsFromAST(init, schemaName, bindings);

        if (fieldMap.size > 0) {
          result.set(schemaName, fieldMap);
        }
      }
    }

    return result;
  }

  /**
   * Extracts getter field info from AST nodes.
   */
  private extractGetterFieldsFromAST(
    node: Node,
    schemaName: string,
    bindings: ValibotBindings,
  ): Map<string, GetterFieldInfo> {
    const fieldMap = new Map<string, GetterFieldInfo>();

    // Find all getter declarations within the node
    const getters = node.getDescendantsOfKind(SyntaxKind.GetAccessor);

    for (const getter of getters) {
      const fieldName = getter.getName();
      const body = getter.getBody();
      if (!body) continue;

      // Find return statement
      const returnStmt = body.getFirstDescendantByKind(SyntaxKind.ReturnStatement);
      if (!returnStmt) continue;

      const returnExpr = returnStmt.getExpression();
      if (!returnExpr) continue;

      // Any identifier can be the referenced schema here: a getter exists
      // precisely because the reference is not resolvable yet, so it cannot be
      // matched against the set of already-detected schemas.
      const ref = analyzeSchemaExpression(returnExpr, bindings, () => true);
      if (ref) {
        fieldMap.set(fieldName, { ...ref, isSelfRef: ref.refSchema === schemaName });
      }
    }

    return fieldMap;
  }

  /**
   * Replaces the `any` placeholders a recursive getter leaves behind.
   *
   * TypeScript cannot infer a getter that refers back to the schema it belongs
   * to, so the whole entry surfaces as `any` - and because `any` satisfies
   * Valibot's optional-key detection in both directions, the key is printed as
   * optional whether or not it really is. Both are rebuilt here from what the
   * getter's AST actually says.
   *
   * When the getter carries an explicit return type annotation, TypeScript gets
   * one level further before giving up, so the printed type holds a full inline
   * copy of the schema whose innermost recursion point is the `any`. That copy
   * says nothing the self-reference does not, so it is collapsed away too - see
   * `collapseInlinedCopies`.
   *
   * @param typeStr - The extracted type string with `any` placeholders
   * @param getterFields - Map of field name to getter field info
   * @param typeName - The generated type name to use for self-references
   * @param options - Set `collapseInlinedCopies: false` to keep the inline copy,
   *   which is what callers that have no name to point at have to do
   * @returns The resolved type string with proper self-references
   */
  resolveAnyTypes(
    typeStr: string,
    getterFields: Map<string, GetterFieldInfo>,
    typeName: string,
    options: { collapseInlinedCopies?: boolean } = {},
  ): string {
    const { collapseInlinedCopies = true } = options;
    const selfRefFields = [...getterFields].filter(([, info]) => info.isSelfRef);
    const selfRefNames = selfRefFields.map(([fieldName]) => fieldName);

    let result = typeStr;
    for (const [fieldName, info] of selfRefFields) {
      result = this.replaceFieldPlaceholder(
        result,
        fieldName,
        typeName,
        info,
        collapseInlinedCopies ? selfRefNames : [],
      );
    }

    return result;
  }

  /**
   * Rewrites every recursive occurrence of a field to the getter's real type.
   *
   * A field qualifies when its printed type is an `any` placeholder, or - when
   * `collapsibleFields` is given - when it is an inline copy of the schema,
   * recognised by an `any` placeholder for one of those fields somewhere inside
   * it.
   */
  private replaceFieldPlaceholder(
    typeStr: string,
    fieldName: string,
    typeName: string,
    info: GetterFieldInfo,
    collapsibleFields: string[],
  ): string {
    const replacement = buildReplacementType(typeName, info);
    const marker = info.isOptional ? "?" : "";
    let result = typeStr;
    let searchFrom = 0;

    for (;;) {
      const field = findFieldValue(result, fieldName, searchFrom);
      if (!field) return result;

      const value = result.slice(field.valueStart, field.valueEnd);
      if (!isAnyPlaceholder(value) && !isInlinedRecursiveCopy(value, collapsibleFields)) {
        searchFrom = field.valueStart;
        continue;
      }

      const rewritten = `${marker}: ${replacement}`;
      result = result.slice(0, field.nameEnd) + rewritten + result.slice(field.valueEnd);
      searchFrom = field.nameEnd + rewritten.length;
    }
  }

  /**
   * Checks if a schema has getter-based self-references.
   */
  hasSelfReferences(getterFields: Map<string, GetterFieldInfo>): boolean {
    return Array.from(getterFields.values()).some((info) => info.isSelfRef);
  }
}

/**
 * Builds the type a getter field should have, from the shape its AST describes.
 *
 * `isOptional` (key may be omitted) is handled separately via the `?` marker in
 * `replaceFieldPlaceholder` - it is not repeated in the type itself, matching how
 * a plain `v.optional()` field is already printed elsewhere. `isNullable` and
 * `isUndefinedable` are independent of the key's optionality (Valibot's
 * `v.nullable()` / `v.undefinedable()` widen the value's type without making the
 * key optional), so they are appended here whenever set, including together with
 * `isOptional` (e.g. `v.nullish()`, or `v.optional(v.nullable(...))`).
 */
function buildReplacementType(typeName: string, info: GetterFieldInfo): string {
  const base = info.isArray
    ? `${typeName}[]`
    : info.isRecord
      ? `{ [x: string]: ${typeName}; }`
      : typeName;

  const suffixes: string[] = [];
  if (info.isNullable) suffixes.push("null");
  if (info.isUndefinedable) suffixes.push("undefined");
  if (suffixes.length === 0) return base;
  return `${base} | ${suffixes.join(" | ")}`;
}

/**
 * Checks whether a printed field type is nothing but an `any` placeholder.
 *
 * An annotated getter whose wrapper widens the value's type (`v.optional()`,
 * `v.nullable()`, `v.nullish()`, `v.undefinedable()`, or any combination of
 * them) prints its placeholder with that widening still attached - e.g.
 * `any | null | undefined` - because TypeScript derives the property's declared
 * type from the wrapper regardless of whether the key itself ends up marked
 * optional. That suffix carries no information `buildReplacementType` does not
 * already reconstruct from the AST, so any trailing run of `| null` / `| undefined`
 * segments, in any order or repetition, is stripped here before the placeholder
 * check.
 */
function isAnyPlaceholder(value: string): boolean {
  const normalized = value
    .trim()
    .replace(/^readonly\s+/, "")
    .replace(/(?:\s*\|\s*(?:null|undefined))+$/, "")
    .trim();
  return /^any(\[\])?$/.test(normalized) || /^\{\s*\[x: string\]:\s*any;?\s*\}$/.test(normalized);
}

/**
 * Checks whether a printed field type is an inline copy of the schema it belongs
 * to, rather than the schema's own printed shape.
 *
 * The copy always bottoms out in an `any` placeholder for one of the schema's
 * recursive getter fields - that placeholder is precisely where TypeScript gave
 * up - so finding one inside the value identifies the whole value as an unfolded
 * step of the recursion.
 */
function isInlinedRecursiveCopy(value: string, selfRefFields: string[]): boolean {
  return selfRefFields.some((fieldName) => {
    let searchFrom = 0;
    for (;;) {
      const nested = findFieldValue(value, fieldName, searchFrom);
      if (!nested) return false;
      if (isAnyPlaceholder(value.slice(nested.valueStart, nested.valueEnd))) return true;
      searchFrom = nested.valueStart;
    }
  });
}

/**
 * Locates a field and its type inside a printed object type.
 *
 * @returns Offsets for the end of the field name and the bounds of its type,
 *   or undefined when the field does not occur after `searchFrom`
 */
function findFieldValue(
  typeStr: string,
  fieldName: string,
  searchFrom: number,
): { nameEnd: number; valueStart: number; valueEnd: number } | undefined {
  const pattern = new RegExp(`(?:^|[{;|(]\\s*)(${escapeRegExp(fieldName)})\\??:\\s*`, "g");
  pattern.lastIndex = searchFrom;

  const match = pattern.exec(typeStr);
  if (!match) return undefined;

  const nameEnd = match.index + match[0].indexOf(match[1]) + fieldName.length;
  const valueStart = match.index + match[0].length;

  return { nameEnd, valueStart, valueEnd: findValueEnd(typeStr, valueStart) };
}

/**
 * Finds where a field's type ends, tracking nesting and string literals.
 */
function findValueEnd(typeStr: string, valueStart: number): number {
  let depth = 0;
  let index = valueStart;
  let inString = false;
  let stringChar = "";

  while (index < typeStr.length) {
    const char = typeStr[index];

    if ((char === '"' || char === "'" || char === "`") && !isEscaped(typeStr, index)) {
      if (!inString) {
        inString = true;
        stringChar = char;
      } else if (char === stringChar) {
        inString = false;
        stringChar = "";
      }
    }

    if (!inString) {
      if (char === "{" || char === "[" || char === "(" || char === "<") {
        depth++;
      } else if (char === "}" || char === "]" || char === ")" || char === ">") {
        if (depth === 0) break;
        depth--;
      } else if (char === ";" && depth === 0) {
        break;
      }
    }
    index++;
  }

  return index;
}

/**
 * Escapes special characters in a string for use in a RegExp.
 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
