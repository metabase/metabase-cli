import { describe, expect, it } from "vitest";

import { userView } from "./user";

describe("userView", () => {
  it("declares id, email, name, and admin columns", () => {
    expect(userView.tableColumns).toEqual([
      { key: "id", label: "ID" },
      { key: "email", label: "Email" },
      { key: "common_name", label: "Name" },
      { key: "is_superuser", label: "Admin" },
    ]);
  });
});
