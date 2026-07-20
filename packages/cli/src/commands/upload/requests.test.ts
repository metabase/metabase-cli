import { describe, expect, it } from "vitest";

import { parseCreateUploadResult } from "./requests";

describe("parseCreateUploadResult", () => {
  it("reads the model id from the body and the table id from the header", () => {
    const headers = new Headers({ "metabase-table-id": "45" });
    expect(parseCreateUploadResult("  123\n", headers)).toEqual({ model_id: 123, table_id: 45 });
  });

  it("throws when the body is not an integer", () => {
    expect(() =>
      parseCreateUploadResult("abc", new Headers({ "metabase-table-id": "45" })),
    ).toThrow('upload succeeded but the response body was not an integer: "abc"');
  });

  it("throws when the table-id header is absent", () => {
    expect(() => parseCreateUploadResult("123", new Headers())).toThrow(
      "upload succeeded but the metabase-table-id header was empty",
    );
  });
});
