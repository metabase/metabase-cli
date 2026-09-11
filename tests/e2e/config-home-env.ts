import { ENV_DISABLE_KEYRING } from "../../packages/cli/src/core/env";

// The CLI's storage module reads the config home from the environment, so seeding a profile from
// the test process means pointing it at the test's isolated home for the duration of the write and
// putting the previous values back afterwards.
export async function withConfigHomeEnv<T>(configHome: string, seed: () => Promise<T>): Promise<T> {
  const prevXdg = process.env["XDG_CONFIG_HOME"];
  const prevKeyring = process.env[ENV_DISABLE_KEYRING];
  process.env["XDG_CONFIG_HOME"] = configHome;
  process.env[ENV_DISABLE_KEYRING] = "1";
  try {
    return await seed();
  } finally {
    restoreEnv("XDG_CONFIG_HOME", prevXdg);
    restoreEnv(ENV_DISABLE_KEYRING, prevKeyring);
  }
}

function restoreEnv(key: string, previous: string | undefined): void {
  if (previous === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = previous;
  }
}
