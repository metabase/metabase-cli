import { describe, expect, it } from "vitest";

import { scanBodyMethods, type UnpairedBody } from "../../../../tests/e2e/body-routes";
import * as barrel from "../index";
import type { MethodKey } from "../version/requirements";

const INPUT_SUFFIX = "Input";

const UNSENT_INPUTS: Readonly<Record<string, string>> = {
  DashboardLayoutInput: "the CLI's dashboard create sends it through dashboard.update",
  DashcardPatchInput:
    "dashboard.updateDashcard merges it into the dashcards dashboard.update sends",
  TipTapNodeInput: "nested in the document inputs",
  TransformTestInput: "nested in the transform test inputs",
};

interface UncheckedBody extends UnpairedBody {
  readonly reason: string;
}

const UNCHECKED_BODIES: readonly UncheckedBody[] = [
  { key: "card.query", bodyType: null, reason: "sends only the parameters of its params" },
  { key: "card.exportQuery", bodyType: null, reason: "a form-encoded body" },
  { key: "contentTranslation.upload", bodyType: "CsvFile", reason: "a multipart upload" },
  { key: "dashboard.archive", bodyType: null, reason: "a fixed body" },
  { key: "dataset.query", bodyType: "unknown", reason: "a query, checked against the MBQL schema" },
  { key: "dataset.native", bodyType: null, reason: "a query, checked against the MBQL schema" },
  { key: "dataset.exportQuery", bodyType: null, reason: "built from the export params" },
  {
    key: "dataset.queryMetadata",
    bodyType: "DatasetQuery",
    reason: "a query, checked against the MBQL schema",
  },
  {
    key: "field.setDataSensitivity",
    bodyType: "FieldSetDataSensitivityParams",
    reason: "one field of field.update's body",
  },
  { key: "gitSync.import", bodyType: null, reason: "built from the import params" },
  { key: "gitSync.export", bodyType: null, reason: "built from the export params" },
  { key: "gitSync.stash", bodyType: null, reason: "built from the stash params" },
  { key: "gitSync.createBranch", bodyType: null, reason: "built from the branch params" },
  { key: "gitSync.setCollectionSynced", bodyType: null, reason: "a settings update" },
  { key: "metric.query", bodyType: null, reason: "a metric definition" },
  { key: "metric.breakoutValues", bodyType: null, reason: "a metric definition" },
  { key: "setting.set", bodyType: null, reason: "a setting's value, whose shape the key decides" },
  { key: "table.appendCsv", bodyType: "CsvFile", reason: "a multipart upload" },
  { key: "table.replaceCsv", bodyType: "CsvFile", reason: "a multipart upload" },
  { key: "transform.runDag", bodyType: null, reason: "sends only the direction of its params" },
  { key: "transformJob.run", bodyType: null, reason: "sends only run_all of its params" },
  { key: "transformJob.setActive", bodyType: null, reason: "a single flag" },
  { key: "upload.createFromCsv", bodyType: "CsvFile", reason: "a multipart upload" },
];

function reasons(entries: readonly (readonly [string, string])[]): string {
  return entries.map(([name, reason]) => `${name}: ${reason}`).join("\n");
}

function unpairedEntry({ key, bodyType }: UncheckedBody): UnpairedBody {
  return { key, bodyType };
}

function keyOrder(left: UnpairedBody, right: UnpairedBody): number {
  return left.key.localeCompare(right.key);
}

const { paired, unpaired } = scanBodyMethods();

describe("the OpenAPI drift lane's coverage", () => {
  it("pairs every input schema on the client barrel with a method that sends it, but those no method sends on its own", () => {
    const sent = new Set(paired.map(({ inputName }) => inputName));
    const unsent = Object.keys(barrel)
      .filter((name) => name.endsWith(INPUT_SUFFIX) && !sent.has(name))
      .toSorted();

    expect(unsent, reasons(Object.entries(UNSENT_INPUTS))).toEqual(
      Object.keys(UNSENT_INPUTS).toSorted(),
    );
  });

  it("checks every method that sends a body, but those whose body no input schema describes", () => {
    const listed = reasons(UNCHECKED_BODIES.map(({ key, reason }) => [key, reason]));

    expect(unpaired.toSorted(keyOrder), listed).toEqual(
      UNCHECKED_BODIES.map(unpairedEntry).toSorted(keyOrder),
    );
  });

  it("checks the methods that send table selectors", () => {
    const selectorKeys: MethodKey[] = paired
      .filter(({ inputName }) => inputName === "TableSelectors")
      .map(({ key }) => key);

    expect(selectorKeys.toSorted()).toEqual([
      "library.unpublishTables",
      "table.bulkDiscardValues",
      "table.bulkRescanValues",
      "table.bulkSyncSchema",
    ]);
  });
});
