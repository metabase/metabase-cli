import type { AutocompleteSuggestions } from "@earendil-works/pi-tui";
import { expect, test } from "vitest";
import { withoutSkillCommands } from "./skill-commands";

const SUGGESTIONS: AutocompleteSuggestions = {
  prefix: "/",
  items: [
    { value: "/model", label: "/model" },
    { value: "/skill:mbql", label: "/skill:mbql", description: "The MBQL grammar" },
    { value: "/mb-login", label: "/mb-login" },
    { value: "/skill:dashboard", label: "/skill:dashboard" },
  ],
};

test("the skills stay loaded for the model and stop being offered to the operator", () => {
  expect(withoutSkillCommands(SUGGESTIONS)).toEqual({
    prefix: "/",
    items: [
      { value: "/model", label: "/model" },
      { value: "/mb-login", label: "/mb-login" },
    ],
  });
});

test("a menu holding no skill leaves with the object it arrived as", () => {
  const commands: AutocompleteSuggestions = {
    prefix: "/",
    items: [{ value: "/model", label: "/model" }],
  };

  expect(withoutSkillCommands(commands)).toBe(commands);
});

test("nothing to complete stays nothing to complete", () => {
  expect(withoutSkillCommands(null)).toBe(null);
});
