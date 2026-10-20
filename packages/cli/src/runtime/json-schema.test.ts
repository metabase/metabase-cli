import { describe, expect, it } from "vitest";
import { z } from "zod";

import { toJsonSchema } from "./json-schema";

const DRAFT_2020_12 = "https://json-schema.org/draft/2020-12/schema";

describe("toJsonSchema", () => {
  it("lets an optional tuple element be left out", () => {
    const schema = toJsonSchema(z.tuple([z.string(), z.number().optional()]), { io: "input" });

    expect(schema).toEqual({
      $schema: DRAFT_2020_12,
      type: "array",
      prefixItems: [{ type: "string" }, { type: "number" }],
      minItems: 1,
      items: false,
    });
  });

  it("requires a defaulted tuple element in the output, where the default has filled it in", () => {
    const schema = toJsonSchema(z.tuple([z.string(), z.number().default(1)]), { io: "output" });

    expect(schema).toEqual({
      $schema: DRAFT_2020_12,
      type: "array",
      prefixItems: [{ type: "string" }, { type: "number", default: 1 }],
      minItems: 2,
      items: false,
    });
  });

  it("closes a tuple with no rest element", () => {
    expect(toJsonSchema(z.tuple([z.string()]), { io: "input" })).toEqual({
      $schema: DRAFT_2020_12,
      type: "array",
      prefixItems: [{ type: "string" }],
      minItems: 1,
      items: false,
    });
  });

  it("appends a refinement's message to the description", () => {
    const Name = z
      .string()
      .describe("The display name")
      .refine((value) => value.trim() !== "", "the name must not be blank");

    expect(toJsonSchema(Name, { io: "input" })).toEqual({
      $schema: DRAFT_2020_12,
      type: "string",
      description: "The display name; refined: the name must not be blank",
    });
  });

  it("leaves a described copy of a reused tuple as a bare reference to the one definition", () => {
    const Pair = z.tuple([z.string(), z.number().optional()]);
    const schema = toJsonSchema(
      z.strictObject({ plain: Pair, titled: Pair.meta({ title: "Pair" }) }),
      { io: "input", reused: "ref" },
    );

    expect(schema).toEqual({
      $schema: DRAFT_2020_12,
      type: "object",
      properties: {
        plain: { $ref: "#/$defs/__schema0" },
        titled: { title: "Pair", $ref: "#/$defs/__schema0" },
      },
      required: ["plain", "titled"],
      additionalProperties: false,
      $defs: {
        __schema0: {
          type: "array",
          prefixItems: [{ $ref: "#/$defs/__schema1" }, { $ref: "#/$defs/__schema2" }],
          minItems: 1,
          items: false,
        },
        __schema1: { type: "string" },
        __schema2: { type: "number" },
      },
    });
  });

  it("leaves a derived copy of a reused refinement to the definition that notes it", () => {
    const Name = z.string().refine((value) => value !== "", "not blank");
    const schema = toJsonSchema(
      z.strictObject({ plain: Name, described: Name.describe("x"), longer: Name.min(2) }),
      { io: "input", reused: "ref" },
    );

    expect(schema).toEqual({
      $schema: DRAFT_2020_12,
      type: "object",
      properties: {
        plain: { $ref: "#/$defs/__schema0" },
        described: { description: "x", $ref: "#/$defs/__schema0" },
        longer: { minLength: 2, $ref: "#/$defs/__schema0" },
      },
      required: ["plain", "described", "longer"],
      additionalProperties: false,
      $defs: { __schema0: { type: "string", description: "refined: not blank" } },
    });
  });

  it.each([
    ["refine", z.string().refine((value) => value !== "")],
    ["superRefine", z.string().superRefine(() => undefined)],
  ])("refuses a %s with no static message", (_kind, schema) => {
    expect(() => toJsonSchema(schema, { io: "input" })).toThrow(
      new Error("a refinement on a string schema has no static message to note"),
    );
  });

  it("raises a length check weaker than the tuple's required elements", () => {
    const schema = toJsonSchema(z.tuple([z.string(), z.number()]).check(z.minLength(1)), {
      io: "input",
    });

    expect(schema).toEqual({
      $schema: DRAFT_2020_12,
      type: "array",
      prefixItems: [{ type: "string" }, { type: "number" }],
      minItems: 2,
      items: false,
    });
  });
});
