import { beforeEach } from "vitest";

import { resetToCliDefault } from "./reset";
import { resetWarehouse } from "./warehouse";

beforeEach(async () => {
  await resetToCliDefault();
  await resetWarehouse();
});
