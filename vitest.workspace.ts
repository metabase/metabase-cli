import { fileURLToPath } from "node:url";

import { defineWorkspace } from "vitest/config";

const CLIENT_SRC = fileURLToPath(new URL("./packages/client/src", import.meta.url));

// `@metabase/client`'s export map names its built output, which is what a consumer installs. In this
// workspace every importer reads the source, matching the `paths` mapping in the root tsconfig.
const clientSource = {
  alias: [
    { find: /^@metabase\/client$/, replacement: `${CLIENT_SRC}/index.ts` },
    { find: /^@metabase\/client\//, replacement: `${CLIENT_SRC}/` },
  ],
};

export default defineWorkspace([
  {
    resolve: clientSource,
    test: {
      name: "unit",
      include: ["packages/cli/src/**/*.test.ts", "packages/client/src/**/*.test.ts"],
    },
  },
  {
    resolve: clientSource,
    test: {
      name: "e2e",
      include: ["tests/e2e/**/*.e2e.test.ts"],
      testTimeout: 120_000,
      hookTimeout: 120_000,
      poolOptions: {
        forks: { singleFork: true },
      },
      globalSetup: ["tests/e2e/setup/global-setup.ts"],
      setupFiles: ["tests/e2e/setup/restore-each.ts"],
    },
  },
]);
