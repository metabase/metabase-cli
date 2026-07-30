import { describe, expect, it } from "vitest";

import { buildTestRunFormData, type TestRunParams } from "./transform-test";

function csvFile(filename: string, text: string): { filename: string; bytes: Uint8Array } {
  return { filename, bytes: new TextEncoder().encode(text) };
}

function params(over: Partial<TestRunParams>): TestRunParams {
  return { sources: [], inputs: [], ignore_columns: [], assertions: [], ...over };
}

async function formFields(form: FormData): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    out[key] = typeof value === "string" ? value : await value.text();
  }
  return out;
}

describe("buildTestRunFormData", () => {
  it("appends an assertions JSON part when assertions are present", async () => {
    const form = buildTestRunFormData(
      params({
        expected: csvFile("expected.csv", "id\n1\n"),
        assertions: [{ name: "a", sql: "SELECT 1", severity: "error" }],
      }),
    );
    const fields = await formFields(form);
    expect(fields["assertions"]).toBe(
      JSON.stringify([{ name: "a", sql: "SELECT 1", severity: "error" }]),
    );
    expect(fields["expected"]).toBe("id\n1\n");
  });

  it("omits the expected part when no expected file is given (assertions-only)", async () => {
    const form = buildTestRunFormData(
      params({ assertions: [{ name: "a", sql: "SELECT 1", severity: "error" }] }),
    );
    const fields = await formFields(form);
    expect(fields["expected"]).toBeUndefined();
    expect(fields["assertions"]).toBeDefined();
  });

  it("omits the assertions part when there are no assertions", async () => {
    const form = buildTestRunFormData(params({ expected: csvFile("expected.csv", "id\n1\n") }));
    const fields = await formFields(form);
    expect(fields["assertions"]).toBeUndefined();
  });

  it("names each input part by its table id and carries the fixture bytes", async () => {
    const form = buildTestRunFormData(
      params({
        sources: [172],
        inputs: [{ table_id: 229, file: csvFile("orders.csv", "id,total\n1,10\n") }],
        ignore_columns: ["snapshot_ts"],
        assertions: [{ name: "a", sql: "SELECT 1", severity: "error" }],
      }),
    );
    const fields = await formFields(form);
    expect(fields["input-229"]).toBe("id,total\n1,10\n");
    expect(fields["sources"]).toBe("[172]");
    expect(fields["options"]).toBe(JSON.stringify({ ignore_columns: ["snapshot_ts"] }));
  });
});
