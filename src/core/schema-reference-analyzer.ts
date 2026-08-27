import { SourceFile, Node, CallExpression } from "ts-morph";
import {
  ValibotBindings,
  VALIBOT_OBJECT_BUILDERS,
  VALIBOT_PIPE_BUILDERS,
  VALIBOT_UNION_BUILDERS,
  VALIBOT_VARIANT_BUILDERS,
} from "./valibot-bindings.js";
import { analyzeSchemaExpression, unwrapExpression } from "./schema-expression.js";

/**
 * Information about a schema reference within another schema.
 */
export interface SchemaReferenceInfo {
  /** The field path where the reference occurs (e.g., "output", "input") */
  fieldPath: string;
  /** The referenced schema name */
  refSchema: string;
  /** Whether wrapped in `v.array()` */
  isArray: boolean;
  /** Whether wrapped in `v.record()` */
  isRecord: boolean;
  /** Whether optional */
  isOptional: boolean;
  /** Whether the value type includes `null` */
  isNullable: boolean;
  /** Whether the value type includes `undefined` without the key being optional */
  isUndefinedable: boolean;
}

/**
 * Information about union member references.
 */
export interface UnionReferenceInfo {
  /** The referenced schema names (members of the union) */
  memberSchemas: string[];
  /** Whether the union also contains members that are not named schema references */
  hasInlineMembers: boolean;
  /** Whether this is a variant (Valibot's discriminated union) */
  isDiscriminated: boolean;
  /** The discriminator key for variants */
  discriminatorKey?: string;
}

/**
 * Map of schema name to its references to other schemas.
 */
export type SchemaReferenceMap = Map<string, SchemaReferenceInfo[]>;

/**
 * Map of schema name to its union member references.
 */
export type UnionReferenceMap = Map<string, UnionReferenceInfo>;

/**
 * Analyzes schema references to detect cross-schema dependencies.
 */
export class SchemaReferenceAnalyzer {
  /**
   * Analyzes a source file to find all schema references and union references in a single pass.
   */
  analyzeAllReferences(
    sourceFile: SourceFile,
    schemaNames: Set<string>,
  ): { references: SchemaReferenceMap; unionReferences: UnionReferenceMap } {
    const references: SchemaReferenceMap = new Map();
    const unionReferences: UnionReferenceMap = new Map();
    const bindings = ValibotBindings.from(sourceFile);

    const statements = sourceFile.getVariableStatements();
    for (const stmt of statements) {
      for (const decl of stmt.getDeclarations()) {
        const schemaName = decl.getName();
        if (!schemaNames.has(schemaName)) continue;

        const init = decl.getInitializer();
        if (!init) continue;

        const refs = this.findSchemaReferences(init, schemaNames, schemaName, bindings);
        if (refs.length > 0) {
          references.set(schemaName, refs);
        }

        const unionRef = this.findUnionReference(init, schemaNames, schemaName, bindings);
        if (unionRef) {
          unionReferences.set(schemaName, unionRef);
        }
      }
    }

    return { references, unionReferences };
  }

  /**
   * Finds union references in a schema definition.
   */
  private findUnionReference(
    node: Node,
    schemaNames: Set<string>,
    currentSchema: string,
    bindings: ValibotBindings,
  ): UnionReferenceInfo | undefined {
    // Unwrap type-preserving pipes like v.pipe(v.union([...]), v.description("..."))
    let current = unwrapExpression(node);
    while (Node.isCallExpression(current) && bindings.isCallTo(current, VALIBOT_PIPE_BUILDERS)) {
      const args = current.getArguments();
      if (args.length === 0) return undefined;
      current = unwrapExpression(args[0]);
    }

    if (!Node.isCallExpression(current)) {
      return undefined;
    }

    const callName = bindings.getCallName(current);
    if (!callName) {
      return undefined;
    }

    if (VALIBOT_VARIANT_BUILDERS.has(callName)) {
      return this.parseVariant(current, schemaNames, currentSchema);
    }

    if (VALIBOT_UNION_BUILDERS.has(callName)) {
      return this.parseUnion(current, schemaNames, currentSchema);
    }

    return undefined;
  }

  /**
   * Parses a `v.variant("key", [...])` call.
   */
  private parseVariant(
    node: CallExpression,
    schemaNames: Set<string>,
    currentSchema: string,
  ): UnionReferenceInfo | undefined {
    const args = node.getArguments();
    if (args.length < 2) {
      return undefined;
    }

    // First arg is the discriminator key
    const discriminatorArg = args[0];
    let discriminatorKey: string | undefined;
    if (Node.isStringLiteral(discriminatorArg)) {
      discriminatorKey = discriminatorArg.getLiteralText();
    }

    // Second arg is the array of schemas
    const { memberSchemas, hasInlineMembers } = this.extractSchemaArrayMembers(
      args[1],
      schemaNames,
      currentSchema,
    );

    if (memberSchemas.length === 0) {
      return undefined;
    }

    return {
      memberSchemas,
      hasInlineMembers,
      isDiscriminated: true,
      discriminatorKey,
    };
  }

  /**
   * Parses a `v.union([...])` call.
   */
  private parseUnion(
    node: CallExpression,
    schemaNames: Set<string>,
    currentSchema: string,
  ): UnionReferenceInfo | undefined {
    const args = node.getArguments();
    if (args.length < 1) {
      return undefined;
    }

    // First arg is the array of schemas
    const { memberSchemas, hasInlineMembers } = this.extractSchemaArrayMembers(
      args[0],
      schemaNames,
      currentSchema,
    );

    if (memberSchemas.length === 0) {
      return undefined;
    }

    return {
      memberSchemas,
      hasInlineMembers,
      isDiscriminated: false,
    };
  }

  /**
   * Extracts schema names from an array expression.
   */
  private extractSchemaArrayMembers(
    node: Node,
    schemaNames: Set<string>,
    currentSchema: string,
  ): { memberSchemas: string[]; hasInlineMembers: boolean } {
    const arrayLiteral = unwrapExpression(node);
    if (!Node.isArrayLiteralExpression(arrayLiteral)) {
      return { memberSchemas: [], hasInlineMembers: true };
    }

    const members: string[] = [];
    let hasInlineMembers = false;
    for (const element of arrayLiteral.getElements()) {
      const unwrapped = unwrapExpression(element);
      if (Node.isIdentifier(unwrapped)) {
        const name = unwrapped.getText();
        if (schemaNames.has(name) && name !== currentSchema) {
          members.push(name);
          continue;
        }
      }
      hasInlineMembers = true;
    }

    return { memberSchemas: members, hasInlineMembers };
  }

  /**
   * Finds all references to other schemas within a schema definition.
   */
  private findSchemaReferences(
    node: Node,
    schemaNames: Set<string>,
    currentSchema: string,
    bindings: ValibotBindings,
  ): SchemaReferenceInfo[] {
    const refs: SchemaReferenceInfo[] = [];

    // Find Valibot object calls
    const objectCalls = this.findObjectCalls(node, bindings);

    for (const objectCall of objectCalls) {
      const args = objectCall.getArguments();
      if (args.length === 0) continue;

      const entries = unwrapExpression(args[0]);
      if (!Node.isObjectLiteralExpression(entries)) continue;

      const fields = this.findObjectLiteralReferences(
        entries,
        schemaNames,
        currentSchema,
        bindings,
        new Set(),
      );
      refs.push(...[...fields.values()].filter((ref): ref is SchemaReferenceInfo => ref !== null));
    }

    return refs;
  }

  /**
   * Finds schema references in an entries object, including same-file object-literal spreads.
   * Later properties override earlier spread entries, matching JavaScript object semantics.
   */
  private findObjectLiteralReferences(
    objectLiteral: Node,
    schemaNames: Set<string>,
    currentSchema: string,
    bindings: ValibotBindings,
    visitedShapes: Set<string>,
  ): Map<string, SchemaReferenceInfo | null> {
    if (!Node.isObjectLiteralExpression(objectLiteral)) {
      return new Map();
    }

    const refsByField = new Map<string, SchemaReferenceInfo | null>();

    for (const prop of objectLiteral.getProperties()) {
      if (Node.isSpreadAssignment(prop)) {
        const expression = prop.getExpression();
        if (!Node.isIdentifier(expression)) {
          refsByField.clear();
          continue;
        }

        const declaration = objectLiteral
          .getSourceFile()
          .getVariableDeclaration(expression.getText());
        const initializer = declaration?.getInitializer();
        const shape = initializer ? unwrapExpression(initializer) : undefined;
        if (!declaration || !shape || !Node.isObjectLiteralExpression(shape)) {
          refsByField.clear();
          continue;
        }

        const shapeId = `${declaration.getSourceFile().getFilePath()}:${declaration.getStart()}`;
        if (visitedShapes.has(shapeId)) continue;

        const nextVisitedShapes = new Set(visitedShapes);
        nextVisitedShapes.add(shapeId);
        for (const [fieldName, ref] of this.findObjectLiteralReferences(
          shape,
          schemaNames,
          currentSchema,
          bindings,
          nextVisitedShapes,
        )) {
          refsByField.set(fieldName, ref);
        }
        continue;
      }

      if (!Node.isPropertyAssignment(prop)) continue;

      const fieldName = prop.getName();
      const initializer = prop.getInitializer();
      if (!initializer) continue;

      const ref = analyzeSchemaExpression(
        initializer,
        bindings,
        (name) => schemaNames.has(name) && name !== currentSchema,
      );
      refsByField.set(fieldName, ref ? { fieldPath: fieldName, ...ref } : null);
    }

    return refsByField;
  }

  /**
   * Finds all Valibot object calls in a node (including the node itself).
   */
  private findObjectCalls(node: Node, bindings: ValibotBindings): CallExpression[] {
    const calls: CallExpression[] = [];

    const checkNode = (n: Node) => {
      if (Node.isCallExpression(n) && bindings.isCallTo(n, VALIBOT_OBJECT_BUILDERS)) {
        calls.push(n);
      }
    };

    checkNode(node);
    node.forEachDescendant(checkNode);

    return calls;
  }
}
