import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { renderTypeScript } from "../output/schema-ts";
import { toJsonSchema } from "./json-schema";

const DRAFT_2020_12 = "https://json-schema.org/draft/2020-12/schema";

describe("toJsonSchema", () => {
  it("lets an optional tuple element be left out", () => {
    const schema = toJsonSchema(z.tuple([z.string(), z.number().optional()]), { io: "input" });

    expect(renderTypeScript(schema, { name: "Input" })).toBe("type Input = [string, number?]");
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
      {
        io: "input",
        reused: "ref",
      },
    );
    // An optional element is what strictTuples warns about.
    const validate = new Ajv2020({ strictTuples: false }).compile(schema);

    expect(validate({ plain: ["a"], titled: ["a", 1] })).toBe(true);
    expect(renderTypeScript(schema, { name: "Input", strict: true })).toBe(
      "type Input = { plain: [string, number?], titled: [string, number?] }",
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
