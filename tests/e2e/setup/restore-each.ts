import { afterAll, beforeEach } from "vitest";

import { cleanupCacheHome } from "../run-cli";
import { resetToCliDefault } from "./reset";
import { resetWarehouse } from "./warehouse";

beforeEach(async () => {
  await resetToCliDefault();
  await resetWarehouse();
});

afterAll(async () => {
  await cleanupCacheHome();
});
