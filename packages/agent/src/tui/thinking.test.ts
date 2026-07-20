import { expect, test } from "vitest";
import { thinkingStatus, thinkingSummary } from "./thinking";

test("a bold title is what the model chose to call the block, so it wins", () => {
  expect(
    thinkingSummary("**Checking the orders schema**\n\nI need to find the FK to people…"),
  ).toBe("Checking the orders schema");
});

test("without a title, the first sentence stands in for it", () => {
  expect(thinkingSummary("I should look at the orders table first. Then join to people.")).toBe(
    "I should look at the orders table first.",
  );
});

test("a summary longer than the label has room for is cut, not wrapped", () => {
  const summary = thinkingSummary(`${"a".repeat(100)}. Second sentence.`);

  expect(summary).toBe(`${"a".repeat(63)}…`);
});

test("thinking that has not yet produced a word yields no label to show", () => {
  expect(thinkingSummary("  \n ")).toBe(null);
});

test("a sentence still streaming is summarized from what has arrived", () => {
  expect(thinkingSummary("I should look at the orde")).toBe("I should look at the orde");
});

test("the status follows the reasoning as it streams, and repeats itself for nothing", () => {
  const status = thinkingStatus();

  expect(status.advance("**Checking the ")).toBe("Thinking: Checking the");
  expect(status.advance("orders schema**")).toBe("Thinking: Checking the orders schema");
  expect(status.advance("\n\nI need the FK.")).toBe(null);
});

test("a reset block does not summarize the reasoning that preceded it", () => {
  const status = thinkingStatus();
  status.advance("**Checking the orders schema**");

  status.reset();

  expect(status.advance("**Writing the query**")).toBe("Thinking: Writing the query");
});
