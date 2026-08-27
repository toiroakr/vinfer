import { describe, it, expect } from "vitest";
import { resolve } from "path";
import { Project } from "ts-morph";
import { GetterResolver } from "../src/core/getter-resolver.js";

const fixturesDir = resolve(import.meta.dirname, "fixtures");

describe("GetterResolver", () => {
  const resolver = new GetterResolver();

  function getSourceFile(filename: string) {
    const project = new Project();
    return project.addSourceFileAtPath(resolve(fixturesDir, filename));
  }

  describe("analyzeGetterFields", () => {
    it("should detect getter fields with self-references", () => {
      const sourceFile = getSourceFile("getter-schema.ts");
      const getterFields = resolver.analyzeGetterFields(sourceFile);

      expect(getterFields.size).toBeGreaterThan(0);
      expect(getterFields.has("TreeNodeSchema")).toBe(true);

      const treeNodeFields = getterFields.get("TreeNodeSchema")!;
      expect(treeNodeFields.has("children")).toBe(true);

      const childrenInfo = treeNodeFields.get("children")!;
      expect(childrenInfo.refSchema).toBe("TreeNodeSchema");
      expect(childrenInfo.isSelfRef).toBe(true);
      expect(childrenInfo.isArray).toBe(true);
      expect(childrenInfo.isOptional).toBe(true);
    });

    it("should detect getter fields with record types", () => {
      const sourceFile = getSourceFile("getter-schema.ts");
      const getterFields = resolver.analyzeGetterFields(sourceFile);

      expect(getterFields.has("NestedRecordSchema")).toBe(true);

      const nestedRecordFields = getterFields.get("NestedRecordSchema")!;
      expect(nestedRecordFields.has("items")).toBe(true);

      const itemsInfo = nestedRecordFields.get("items")!;
      expect(itemsInfo.isSelfRef).toBe(true);
      expect(itemsInfo.isRecord).toBe(true);
    });

    it("should return empty map for schemas without getters", () => {
      const sourceFile = getSourceFile("basic-schema.ts");
      const getterFields = resolver.analyzeGetterFields(sourceFile);

      // basic-schema.ts doesn't have getter-based fields
      expect(getterFields.size).toBe(0);
    });
  });

  describe("hasSelfReferences", () => {
    it("should return true when getter fields contain self-references", () => {
      const sourceFile = getSourceFile("getter-schema.ts");
      const getterFields = resolver.analyzeGetterFields(sourceFile);

      const treeNodeFields = getterFields.get("TreeNodeSchema")!;
      expect(resolver.hasSelfReferences(treeNodeFields)).toBe(true);
    });

    it("should return false for empty map", () => {
      const emptyMap = new Map();
      expect(resolver.hasSelfReferences(emptyMap)).toBe(false);
    });
  });

  describe("resolveAnyTypes", () => {
    it("should replace any with type name for array self-references", () => {
      const getterFields = new Map([
        [
          "children",
          {
            refSchema: "TreeNode",
            isArray: true,
            isRecord: false,
            isOptional: true,
            isNullable: false,
            isUndefinedable: false,
            isSelfRef: true,
          },
        ],
      ]);

      const typeStr = "{ value: string; children?: any[]; }";
      const result = resolver.resolveAnyTypes(typeStr, getterFields, "TreeNode");

      expect(result).toBe("{ value: string; children?: TreeNode[]; }");
    });

    it("should replace any with type name for record self-references", () => {
      const getterFields = new Map([
        [
          "items",
          {
            refSchema: "NestedRecord",
            isArray: false,
            isRecord: true,
            isOptional: false,
            isNullable: false,
            isUndefinedable: false,
            isSelfRef: true,
          },
        ],
      ]);

      const typeStr = "{ name: string; items: { [x: string]: any }; }";
      const result = resolver.resolveAnyTypes(typeStr, getterFields, "NestedRecord");

      expect(result).toBe("{ name: string; items: { [x: string]: NestedRecord; }; }");
    });

    it("should rebuild a record from a bare any placeholder", () => {
      // Valibot resolves the whole getter to `any`, so the record shape has to
      // come from the getter's AST rather than from the printed type.
      const getterFields = new Map([
        [
          "items",
          {
            refSchema: "NestedRecord",
            isArray: false,
            isRecord: true,
            isOptional: false,
            isNullable: false,
            isUndefinedable: false,
            isSelfRef: true,
          },
        ],
      ]);

      const typeStr = "{ name: string; items?: any; }";
      const result = resolver.resolveAnyTypes(typeStr, getterFields, "NestedRecord");

      expect(result).toBe("{ name: string; items: { [x: string]: NestedRecord; }; }");
    });

    it("should drop the optional marker when the getter is not optional", () => {
      const getterFields = new Map([
        [
          "children",
          {
            refSchema: "TreeNode",
            isArray: true,
            isRecord: false,
            isOptional: false,
            isNullable: false,
            isUndefinedable: false,
            isSelfRef: true,
          },
        ],
      ]);

      const typeStr = "{ value: string; children?: any; }";
      const result = resolver.resolveAnyTypes(typeStr, getterFields, "TreeNode");

      expect(result).toBe("{ value: string; children: TreeNode[]; }");
    });

    it("should not touch fields whose type is more than a placeholder", () => {
      const getterFields = new Map([
        [
          "child",
          {
            refSchema: "Node",
            isArray: false,
            isRecord: false,
            isOptional: false,
            isNullable: false,
            isUndefinedable: false,
            isSelfRef: true,
          },
        ],
      ]);

      const typeStr = "{ value: string; child: { name: string; }; }";
      const result = resolver.resolveAnyTypes(typeStr, getterFields, "Node");

      expect(result).toBe(typeStr);
    });

    it("should replace every occurrence of a repeated field", () => {
      const getterFields = new Map([
        [
          "next",
          {
            refSchema: "Node",
            isArray: false,
            isRecord: false,
            isOptional: true,
            isNullable: false,
            isUndefinedable: false,
            isSelfRef: true,
          },
        ],
      ]);

      const typeStr = "{ next?: any; } | { next?: any; }";
      const result = resolver.resolveAnyTypes(typeStr, getterFields, "Node");

      expect(result).toBe("{ next?: Node; } | { next?: Node; }");
    });

    it("should collapse an inlined copy of the schema into the self-reference", () => {
      // An annotated getter lets TypeScript unfold one whole copy of the schema
      // before it reaches the recursion, and that copy says nothing the
      // self-reference does not.
      const getterFields = new Map([
        [
          "children",
          {
            refSchema: "Node",
            isArray: false,
            isRecord: true,
            isOptional: false,
            isNullable: false,
            isUndefinedable: false,
            isSelfRef: true,
          },
        ],
      ]);

      const typeStr =
        "{ name: string; children: { [x: string]: { name: string; children: { [x: string]: any; }; }; }; }";
      const result = resolver.resolveAnyTypes(typeStr, getterFields, "Node");

      expect(result).toBe("{ name: string; children: { [x: string]: Node; }; }");
    });

    it("should collapse an inlined copy behind an optional key", () => {
      const getterFields = new Map([
        [
          "children",
          {
            refSchema: "Node",
            isArray: false,
            isRecord: true,
            isOptional: true,
            isNullable: false,
            isUndefinedable: false,
            isSelfRef: true,
          },
        ],
      ]);

      const typeStr =
        "{ name: string; children?: { [x: string]: { name: string; children?: any | undefined; }; } | undefined; }";
      const result = resolver.resolveAnyTypes(typeStr, getterFields, "Node");

      expect(result).toBe("{ name: string; children?: { [x: string]: Node; }; }");
    });

    it("should collapse an inlined copy that bottoms out in a different self-ref field", () => {
      // The unfolded copy of "children" contains no nested "children" any
      // placeholder of its own here - only a "next" one - so recognising it
      // as a copy depends on checking every self-ref field, not just the one
      // currently being resolved.
      const getterFields = new Map([
        [
          "children",
          {
            refSchema: "Node",
            isArray: false,
            isRecord: true,
            isOptional: false,
            isNullable: false,
            isUndefinedable: false,
            isSelfRef: true,
          },
        ],
        [
          "next",
          {
            refSchema: "Node",
            isArray: false,
            isRecord: false,
            isOptional: false,
            isNullable: false,
            isUndefinedable: false,
            isSelfRef: true,
          },
        ],
      ]);

      const typeStr =
        "{ name: string; children: { [x: string]: { name: string; next: any; }; }; next: any; }";
      const result = resolver.resolveAnyTypes(typeStr, getterFields, "Node");

      expect(result).toBe("{ name: string; children: { [x: string]: Node; }; next: Node; }");
    });

    it("should keep the inlined copy when told not to collapse it", () => {
      // Without a name to point at, the copy is the most that can be said - only
      // its innermost placeholder is widened to the shape the getter describes.
      const getterFields = new Map([
        [
          "children",
          {
            refSchema: "Node",
            isArray: false,
            isRecord: true,
            isOptional: false,
            isNullable: false,
            isUndefinedable: false,
            isSelfRef: true,
          },
        ],
      ]);

      const typeStr =
        "{ name: string; children: { [x: string]: { name: string; children: any; }; }; }";
      const result = resolver.resolveAnyTypes(typeStr, getterFields, "any", {
        collapseInlinedCopies: false,
      });

      expect(result).toBe(
        "{ name: string; children: { [x: string]: { name: string; children: { [x: string]: any; }; }; }; }",
      );
    });

    it("should not modify types without self-references", () => {
      const getterFields = new Map([
        [
          "other",
          {
            refSchema: "OtherSchema",
            isArray: false,
            isRecord: false,
            isOptional: false,
            isNullable: false,
            isUndefinedable: false,
            isSelfRef: false,
          },
        ],
      ]);

      const typeStr = "{ value: string; other: any; }";
      const result = resolver.resolveAnyTypes(typeStr, getterFields, "MyType");

      expect(result).toBe("{ value: string; other: any; }");
    });

    it("should handle optional fields", () => {
      const getterFields = new Map([
        [
          "child",
          {
            refSchema: "Node",
            isArray: false,
            isRecord: false,
            isOptional: true,
            isNullable: false,
            isUndefinedable: false,
            isSelfRef: true,
          },
        ],
      ]);

      const typeStr = "{ value: string; child?: any; }";
      const result = resolver.resolveAnyTypes(typeStr, getterFields, "Node");

      expect(result).toBe("{ value: string; child?: Node; }");
    });

    it("should keep the key required and add `| null` for a nullable-only field", () => {
      // v.nullable() (unlike v.optional()) does not mark the object key itself
      // optional - only the value's type widens.
      const getterFields = new Map([
        [
          "children",
          {
            refSchema: "Node",
            isArray: true,
            isRecord: false,
            isOptional: false,
            isNullable: true,
            isUndefinedable: false,
            isSelfRef: true,
          },
        ],
      ]);

      const typeStr = "{ value: string; children: any | null; }";
      const result = resolver.resolveAnyTypes(typeStr, getterFields, "Node");

      expect(result).toBe("{ value: string; children: Node[] | null; }");
    });

    it("should mark the key optional and add `| null` for a nullish field", () => {
      const getterFields = new Map([
        [
          "children",
          {
            refSchema: "Node",
            isArray: true,
            isRecord: false,
            isOptional: true,
            isNullable: true,
            isUndefinedable: false,
            isSelfRef: true,
          },
        ],
      ]);

      const typeStr = "{ value: string; children?: any | null | undefined; }";
      const result = resolver.resolveAnyTypes(typeStr, getterFields, "Node");

      expect(result).toBe("{ value: string; children?: Node[] | null; }");
    });

    it("should keep the key required and add `| undefined` for an undefinedable-only field", () => {
      // v.undefinedable() (unlike v.optional()) does not mark the object key
      // itself optional - only the value's type widens.
      const getterFields = new Map([
        [
          "children",
          {
            refSchema: "Node",
            isArray: true,
            isRecord: false,
            isOptional: false,
            isNullable: false,
            isUndefinedable: true,
            isSelfRef: true,
          },
        ],
      ]);

      const typeStr = "{ value: string; children: any | undefined; }";
      const result = resolver.resolveAnyTypes(typeStr, getterFields, "Node");

      expect(result).toBe("{ value: string; children: Node[] | undefined; }");
    });
  });
});
