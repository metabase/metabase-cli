import { describe, expect, it } from "vitest";
import { z } from "zod";

import { parseJson } from "@metabase/client/json";

import { renderTypeScript } from "./schema-ts";

const OPEN_OBJECTS_HEADER = "// Objects accept keys beyond the ones listed.";

// Written as JSON text: a JSON Schema conditional carries a `then` key no object literal may have.
function parseFixture(text: string): unknown {
  return parseJson(text, z.unknown());
}

function renderInput(schema: unknown): string {
  return renderTypeScript(schema, { name: "Input", strict: true });
}

function renderZodInput(schema: z.ZodType): string {
  return renderInput(z.toJSONSchema(schema, { io: "input", reused: "ref" }));
}

describe("renderTypeScript", () => {
  it("marks a defaulted property optional and notes its default", () => {
    const schema = {
      type: "object",
      properties: {
        name: { type: "string" },
        limit: { type: "integer", exclusiveMinimum: 0, default: 25 },
      },
      required: ["name", "limit"],
      additionalProperties: false,
    };
    expect(renderInput(schema)).toBe(
      ["type Input = {", "name: string", "limit?: number // int; >0; default 25", "}"].join("\n"),
    );
  });

  it("quotes enum literals and property names that are not identifiers", () => {
    const schema = z.strictObject({
      "lib/type": z.literal("mbql/query"),
      display: z.enum(["table", "bar"]),
    });
    expect(renderZodInput(schema)).toBe(
      'type Input = { "lib/type": "mbql/query", display: "table" | "bar" }',
    );
  });

  it("renders a nullable value as a union with null and hoists the branch constraint", () => {
    const schema = z.strictObject({ description: z.string().min(1).nullable() });
    expect(renderZodInput(schema)).toBe(
      ["type Input = {", "description: string | null // non-empty", "}"].join("\n"),
    );
  });

  it("renders a discriminated union as a union of object types", () => {
    const schema = z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("card"), card_id: z.number() }),
      z.strictObject({ kind: z.literal("text"), text: z.string() }),
    ]);
    expect(renderZodInput(schema)).toBe(
      'type Input = { kind: "card", card_id: number } | { kind: "text", text: string }',
    );
  });

  it("parenthesizes a union inside an array", () => {
    expect(renderZodInput(z.array(z.union([z.string(), z.number()])))).toBe(
      "type Input = (string | number)[]",
    );
  });

  it("breaks a long union onto one line per member", () => {
    const schema = z.enum([
      "question",
      "model",
      "metric",
      "dashboard",
      "collection",
      "snippet",
      "transform",
      "document",
    ]);
    expect(renderZodInput(schema)).toBe(
      [
        "type Input =",
        '| "question"',
        '| "model"',
        '| "metric"',
        '| "dashboard"',
        '| "collection"',
        '| "snippet"',
        '| "transform"',
        '| "document"',
      ].join("\n"),
    );
  });

  it("declares a named $defs entry once, ahead of its user, even when it is recursive", () => {
    const schema = {
      $defs: {
        node: {
          type: "object",
          properties: { children: { type: "array", items: { $ref: "#/$defs/node" } } },
          additionalProperties: false,
        },
      },
      type: "object",
      properties: { root: { $ref: "#/$defs/node" }, spare: { $ref: "#/$defs/node" } },
      additionalProperties: false,
    };
    expect(renderInput(schema)).toBe(
      ["type node = { children?: node[] }", "type Input = { root?: node, spare?: node }"].join(
        "\n",
      ),
    );
  });

  it("inlines a schema Zod extracted only because it is reused", () => {
    const Id = z.number().int().positive();
    const schema = z.strictObject({ card_id: Id, dashboard_id: Id });
    expect(renderZodInput(schema)).toBe(
      ["type Input = {", "card_id: number // int; >0", "dashboard_id: number // int; >0", "}"].join(
        "\n",
      ),
    );
  });

  it("names an unnamed reused schema that reaches itself", () => {
    const Tree = z.strictObject({
      name: z.string(),
      get children(): z.ZodArray<typeof Tree> {
        return z.array(Tree);
      },
    });
    const schema = z.strictObject({ tree: Tree, other: Tree });
    expect(renderZodInput(schema)).toBe(
      [
        "type Schema0 = { name: string, children: Schema0[] }",
        "type Input = { tree: Schema0, other: Schema0 }",
      ].join("\n"),
    );
  });

  it("refers to the root by the declared name", () => {
    const schema = { type: "array", items: { $ref: "#" } };
    expect(renderInput(schema)).toBe("type Input = Input[]");
  });

  it("resolves a $ref into another document, including one back into the entry", () => {
    const query = {
      $defs: {
        options: {
          type: "object",
          properties: { uuid: { type: "string" } },
          additionalProperties: false,
        },
      },
      $ref: "ref.yaml#/$defs/field_ref",
    };
    const refs = {
      $defs: {
        field_ref: {
          type: "array",
          prefixItems: [{ const: "field" }, { $ref: "query.yaml#/$defs/options" }],
        },
      },
    };
    const rendered = renderTypeScript(query, {
      name: "Query",
      strict: true,
      documentName: "query.yaml",
      documents: { "ref.yaml": refs },
    });
    expect(rendered).toBe(
      [
        "type options = { uuid?: string }",
        'type field_ref = ["field", options]',
        "type Query = field_ref",
      ].join("\n"),
    );
  });

  it("renders a tuple with its rest element", () => {
    expect(renderZodInput(z.tuple([z.string(), z.boolean()], z.number()))).toBe(
      "type Input = [string, boolean, ...number[]]",
    );
  });

  it("spells a bounded rest out as optional elements", () => {
    const schema = {
      prefixItems: [{ const: "count" }],
      items: { type: "string" },
      minItems: 1,
      maxItems: 3,
    };
    expect(renderInput(schema)).toBe('type Input = ["count", string?, string?]');
  });

  it("renders a map as a Record over its key and value types", () => {
    const schema = z.record(z.string(), z.enum(["enabled", "disabled"]));
    expect(renderZodInput(schema)).toBe('type Input = Record<string, "enabled" | "disabled">');
  });

  it("renders allOf as an intersection", () => {
    const schema = {
      $defs: {
        base: {
          type: "object",
          properties: { id: { type: "string" } },
          additionalProperties: false,
        },
      },
      allOf: [
        { $ref: "#/$defs/base" },
        { type: "object", properties: { alias: { type: "string" } }, additionalProperties: false },
      ],
    };
    expect(renderInput(schema)).toBe(
      ["type base = { id?: string }", "type Input = base & { alias?: string }"].join("\n"),
    );
  });

  it("renders an MBQL tag dispatch as a union of tuples", () => {
    const schema = parseFixture(`{
      "$defs": {
        "expression": {
          "type": ["string", "array"],
          "if": { "type": "array" },
          "then": {
            "minItems": 1,
            "allOf": [
              {
                "if": { "prefixItems": [{ "const": "value" }] },
                "then": { "prefixItems": [{ "const": "value" }, { "type": "number" }], "minItems": 2, "maxItems": 2 }
              },
              {
                "if": { "prefixItems": [{ "enum": ["+", "-"] }] },
                "then": {
                  "prefixItems": [{ "enum": ["+", "-"] }, { "$ref": "#/$defs/expression" }],
                  "items": { "$ref": "#/$defs/expression" },
                  "minItems": 3
                }
              }
            ]
          }
        }
      },
      "$ref": "#/$defs/expression"
    }`);
    expect(renderInput(schema)).toBe(
      [
        'type expression = string | ["value", number] | ["+" | "-", expression, expression, ...expression[]]',
        "type Input = expression",
      ].join("\n"),
    );
  });

  it("renders a property tag dispatch as a union, keeping tags no branch claims", () => {
    const schema = parseFixture(`{
      "type": "object",
      "required": ["strategy"],
      "properties": { "strategy": { "type": "string", "enum": ["default", "num-bins"] } },
      "additionalProperties": false,
      "allOf": [
        {
          "if": { "properties": { "strategy": { "const": "num-bins" } } },
          "then": {
            "required": ["num-bins"],
            "properties": { "num-bins": { "type": "integer", "minimum": 1 } },
            "additionalProperties": false
          }
        }
      ]
    }`);
    expect(renderInput(schema)).toBe(
      [
        'type Input = { strategy: "default" | "num-bins" } & (',
        "| {",
        'strategy: "num-bins"',
        '"num-bins": number // int; >=1',
        "}",
        '| { strategy: "default" }',
        ")",
      ].join("\n"),
    );
  });

  it("renders an if/then/else on a type as the union of both branches", () => {
    const schema = parseFixture(
      `{ "if": { "type": "integer" }, "then": { "type": "integer" }, "else": { "enum": ["current", "last"] } }`,
    );
    expect(renderInput(schema)).toBe(
      ["// int", 'type Input = number | "current" | "last"'].join("\n"),
    );
  });

  it("states once that objects accept extra keys when one does", () => {
    const schema = z.object({ name: z.string() }).loose();
    expect(renderZodInput(schema)).toBe(
      [OPEN_OBJECTS_HEADER, "type Input = { name: string }"].join("\n"),
    );
  });

  it("refuses an unknown keyword in strict mode", () => {
    expect(() => renderInput({ type: "string", nullable: true })).toThrow(
      new Error('unsupported JSON Schema keyword "nullable"'),
    );
  });

  it("skips an unknown keyword outside strict mode", () => {
    const rendered = renderTypeScript({ type: "string", nullable: true }, { name: "Input" });
    expect(rendered).toBe("type Input = string");
  });

  it("drops an ignored keyword in strict mode", () => {
    expect(renderInput({ type: "string", title: "Name", uniqueItems: true })).toBe(
      "type Input = string",
    );
  });
});
