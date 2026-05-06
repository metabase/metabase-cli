import { beforeEach } from "vitest";

import { resetToCliDefault } from "./reset";

beforeEach(async () => {
  await resetToCliDefault();
});
