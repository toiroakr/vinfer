import { describe, it, expect } from "vitest";
import { Project, Node } from "ts-morph";
import { ValibotBindings } from "../src/core/valibot-bindings.js";

function bindingsFor(source: string) {
  const project = new Project();
  const sourceFile = project.createSourceFile(`bindings-${Math.random()}.ts`, source);
  return { bindings: ValibotBindings.from(sourceFile), sourceFile };
}

/**
 * Returns the initializer of `const <name> = ...`.
 */
function initializerOf(source: string, name: string) {
  const { bindings, sourceFile } = bindingsFor(source);
  const initializer = sourceFile.getVariableDeclarationOrThrow(name).getInitializerOrThrow();
  return { bindings, initializer };
}

describe("ValibotBindings", () => {
  describe("namespace imports", () => {
    it("recognizes the conventional `v` alias", () => {
      const { bindings } = bindingsFor('import * as v from "valibot";');
      expect(bindings.isNamespace("v")).toBe(true);
      expect(bindings.isNamespace("valibot")).toBe(false);
    });

    it("recognizes an arbitrary namespace alias", () => {
      const { bindings } = bindingsFor('import * as val from "valibot";');
      expect(bindings.isNamespace("val")).toBe(true);
      expect(bindings.isNamespace("v")).toBe(false);
    });

    it("recognizes a default import as the namespace", () => {
      const { bindings } = bindingsFor('import v from "valibot";');
      expect(bindings.isNamespace("v")).toBe(true);
    });

    it("ignores namespace imports from other modules", () => {
      const { bindings } = bindingsFor('import * as z from "zod";');
      // Falls back to the conventional alias, since no Valibot import was seen.
      expect(bindings.isNamespace("z")).toBe(false);
      expect(bindings.isNamespace("v")).toBe(true);
    });

    it("falls back to the conventional alias when no import is visible", () => {
      const { bindings } = bindingsFor("export const x = 1;");
      expect(bindings.isNamespace("v")).toBe(true);
    });
  });

  describe("getCallName", () => {
    it("resolves namespace calls", () => {
      const { bindings, initializer } = initializerOf(
        ['import * as v from "valibot";', "const S = v.object({});"].join("\n"),
        "S",
      );
      expect(bindings.getCallName(initializer)).toBe("object");
    });

    it("resolves named-import calls", () => {
      const { bindings, initializer } = initializerOf(
        ['import { object } from "valibot";', "const S = object({});"].join("\n"),
        "S",
      );
      expect(bindings.getCallName(initializer)).toBe("object");
    });

    it("resolves aliased named-import calls to the original export name", () => {
      const { bindings, initializer } = initializerOf(
        ['import { object as vObject } from "valibot";', "const S = vObject({});"].join("\n"),
        "S",
      );
      expect(bindings.getCallName(initializer)).toBe("object");
    });

    it("returns undefined for calls that are not Valibot exports", () => {
      const { bindings, initializer } = initializerOf(
        ['import * as v from "valibot";', "const S = helper({ a: v.string() });"].join("\n"),
        "S",
      );
      expect(bindings.getCallName(initializer)).toBeUndefined();
    });

    it("returns undefined for a same-named import from another module", () => {
      const { bindings, initializer } = initializerOf(
        ['import { object } from "./local.js";', "const S = object({});"].join("\n"),
        "S",
      );
      expect(bindings.getCallName(initializer)).toBeUndefined();
    });

    it("returns undefined for non-call expressions", () => {
      const { bindings, initializer } = initializerOf(
        ['import * as v from "valibot";', "const S = 42;"].join("\n"),
        "S",
      );
      expect(Node.isCallExpression(initializer)).toBe(false);
      expect(bindings.getCallName(initializer)).toBeUndefined();
    });
  });

  describe("isCallTo", () => {
    it("matches a single name and a set of names", () => {
      const { bindings, initializer } = initializerOf(
        ['import * as v from "valibot";', "const S = v.array(v.string());"].join("\n"),
        "S",
      );
      expect(bindings.isCallTo(initializer, "array")).toBe(true);
      expect(bindings.isCallTo(initializer, "object")).toBe(false);
      expect(bindings.isCallTo(initializer, new Set(["object", "array"]))).toBe(true);
      expect(bindings.isCallTo(initializer, new Set(["object"]))).toBe(false);
    });
  });

  describe("canonicalizeTypeNames", () => {
    it("strips the namespace qualifier from Brand and Flavor", () => {
      const { bindings } = bindingsFor('import * as v from "valibot";');
      expect(bindings.canonicalizeTypeNames('string & v.Brand<"UserId">')).toBe(
        'string & Brand<"UserId">',
      );
      expect(bindings.canonicalizeTypeNames('string & v.Flavor<"Email">')).toBe(
        'string & Flavor<"Email">',
      );
    });

    it("strips an arbitrary namespace qualifier", () => {
      const { bindings } = bindingsFor('import * as valibot from "valibot";');
      expect(bindings.canonicalizeTypeNames('number & valibot.Brand<"Score">')).toBe(
        'number & Brand<"Score">',
      );
    });

    it("strips the import() form used when there is no namespace import", () => {
      const { bindings } = bindingsFor('import { string } from "valibot";');
      expect(bindings.canonicalizeTypeNames('string & import("valibot").Brand<"UserId">')).toBe(
        'string & Brand<"UserId">',
      );
    });

    it("leaves bare and unrelated type references alone", () => {
      const { bindings } = bindingsFor('import * as v from "valibot";');
      expect(bindings.canonicalizeTypeNames('string & Brand<"UserId">')).toBe(
        'string & Brand<"UserId">',
      );
      expect(bindings.canonicalizeTypeNames('string & other.Brand<"UserId">')).toBe(
        'string & other.Brand<"UserId">',
      );
      expect(bindings.canonicalizeTypeNames('import("./local").Brand<"UserId">')).toBe(
        'import("./local").Brand<"UserId">',
      );
    });

    it("returns the input untouched when there is nothing qualified", () => {
      const { bindings } = bindingsFor('import * as v from "valibot";');
      expect(bindings.canonicalizeTypeNames("{ id: string; }")).toBe("{ id: string; }");
    });
  });

  it("caches bindings per source file", () => {
    const project = new Project();
    const sourceFile = project.createSourceFile("cached.ts", 'import * as v from "valibot";');
    expect(ValibotBindings.from(sourceFile)).toBe(ValibotBindings.from(sourceFile));
  });
});
