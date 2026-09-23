import { describe, expect, it } from "vitest";

import {
  branchName,
  branchSlug,
  promptIdOf,
  sessionTitle,
  slugOfBranch,
  uniqueSlug,
} from "./naming";

describe("branchSlug", () => {
  it("keeps the first five words of the prompt, lowercased and hyphenated", () => {
    expect(branchSlug("Clean the orders table and publish it")).toBe("clean-the-orders-table-and");
  });

  it("drops punctuation rather than encoding it into the branch name", () => {
    expect(branchSlug("Fix `orders_clean`: the NULL rows!")).toBe("fix-orders-clean-the-null");
  });

  it("falls back to a fixed name when the prompt has nothing a branch can carry", () => {
    expect(branchSlug("日本語のみ")).toBe("session");
  });
});

describe("uniqueSlug", () => {
  it("keeps the slug when nothing has taken it", () => {
    expect(uniqueSlug("clean-orders", new Set(["other"]))).toBe("clean-orders");
  });

  it("counts past every suffix already taken", () => {
    const taken = new Set(["clean-orders", "clean-orders-2", "clean-orders-3"]);
    expect(uniqueSlug("clean-orders", taken)).toBe("clean-orders-4");
  });
});

describe("branchName", () => {
  it("round trips a slug through the prefix the app owns", () => {
    expect(slugOfBranch(branchName("clean-orders"))).toBe("clean-orders");
  });

  it("claims no branch the app did not create", () => {
    expect(slugOfBranch("feature/clean-orders")).toBeNull();
  });
});

describe("sessionTitle", () => {
  it("collapses the prompt's whitespace into one line", () => {
    expect(sessionTitle("  Clean the orders\n  table  ")).toBe("Clean the orders table");
  });

  it("cuts a long prompt at the limit and says it was cut", () => {
    const prompt = "Add a transform test for orders_clean that asserts the row count is positive";
    expect(sessionTitle(prompt)).toBe(
      "Add a transform test for orders_clean that asserts the row count is…",
    );
  });
});

describe("promptIdOf", () => {
  it("reads the UUID a prompt's message id was minted from", () => {
    expect(promptIdOf("msg_3b1f7c2e-8d4a-4f6b-9c0e-2a5d7e9f1b3c")).toBe(
      "3b1f7c2e-8d4a-4f6b-9c0e-2a5d7e9f1b3c",
    );
  });

  it("names no prompt for a message id minted anywhere else", () => {
    expect(promptIdOf("msg_01")).toBeNull();
    expect(promptIdOf("item_3b1f7c2e-8d4a-4f6b-9c0e-2a5d7e9f1b3c")).toBeNull();
  });
});
