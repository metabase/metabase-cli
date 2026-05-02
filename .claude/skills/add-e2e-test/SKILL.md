---
name: add-e2e-test
description: Add an end-to-end test that drives the built CLI against a real Metabase via docker compose. Use whenever the user asks to "add an e2e test for `<command>`", "wire `<noun> <verb>` into tests/e2e", "cover the new command end-to-end", or anything that creates a file under `tests/e2e/`. Loading this skill is mandatory before generating any `tests/e2e/**/*.e2e.test.ts` file or modifying the e2e harness — the runtime contract is strict and easy to violate.
---

# add-e2e-test

The e2e tier exists to run the **built `dist/cli.mjs`** against a real Metabase, with no mocks. Subtle violations of the harness contract corrupt shared state for every other test in the run. Reading this is required before generating any e2e file.

## Step 0 — Pre-flight (mandatory, do not skip)

Before generating anything, anchor to the existing harness:

1. `ls tests/e2e/` — see the layout and existing nouns.
2. Read **one** existing e2e test end-to-end (e.g. `tests/e2e/auth.e2e.test.ts`).
3. Read `tests/e2e/run-cli.ts` (helpers) and `tests/e2e/bootstrap-data.ts` (the `Bootstrap` schema you must NOT redeclare).

Skip this and you will reinvent harness pieces that already exist, or redeclare the bootstrap schema and silently drift from the writer.

## When to add an e2e test

- A new command was added under `src/commands/<noun>/<verb>.ts`. Every new command needs an e2e test.
- An existing command grew a flag, output mode, or behavior that unit tests cannot exercise (real network round-trip, real auth flow, real polling).

If the command can be fully covered by colocated `src/**/*.test.ts` unit tests, do **not** add an e2e test — the unit tier is faster and more deterministic.

## Where the test lives

- Path: `tests/e2e/<noun>.e2e.test.ts` (one file per noun, multiple `it`s for verbs/flows).
- File name suffix is **`.e2e.test.ts`** — the vitest project glob requires this. `.test.ts` alone will not run in the e2e tier.

## The runtime contract

You must follow all of these. Each rule has bitten the harness before.

**1. Invoke the CLI only via `runCli`.**

```ts
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";
```

- `runCli({ args, configHome, env, stdin, timeoutMs })` spawns `node dist/cli.mjs` via `execa` with an isolated `XDG_CONFIG_HOME`, `METABASE_CLI_DISABLE_KEYRING=1`, and stripped env (no inherited `METABASE_*`).
- **Do not** import `execa`, `child_process`, `node:child_process`, or `spawn` directly.
- **Do not** call `fetch` against the Metabase instance. Bootstrap owns network setup; tests drive the CLI.
- **Do not** spread `process.env` into the `env` param. `env: process.env`, `env: { ...process.env, ... }`, and friends defeat the entire isolation guarantee — they let developer-shell `METABASE_*` leak into the test. Pass only the explicit keys you need.

**1a. No mocks in the e2e tier.**

The whole point of e2e is end-to-end with real I/O. These are forbidden anywhere under `tests/e2e/`:

- `vi.mock(...)`
- `vi.spyOn(...)`
- `vi.hoisted(...)`
- `vi.fn(...)` to stand in for a real dep

If you find yourself wanting a mock, you are in the wrong tier — write a unit test colocated under `src/`.

**2. Read admin credentials only via `readBootstrap()`.**

```ts
import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";

let bootstrap: E2EBootstrap;
beforeAll(async () => {
  bootstrap = await readBootstrap();
});
```

- The `Bootstrap` schema lives in `tests/e2e/bootstrap-data.ts`. **Never redeclare it.** If you need a new field, edit the schema there — the writer (`tests/e2e/setup/bootstrap.ts`) consumes the same type, so drift is mechanically prevented.
- The seeded `bootstrap.adminApiKey` authenticates as a synthetic api-key user (email `api-key-user-…@api-key.invalid`). For tests that need a real human admin, use `auth login --email --password` with `bootstrap.admin.email` / `bootstrap.admin.password` and **explain in the test name why** — don't paper over it.
- **Never invoke the setup wizard from a test.** That mutates global state. Bootstrap runs once per `bun run test:e2e` via `tests/e2e/setup/global-setup.ts`.
- **Never hard-code an API key.** Always read from `bootstrap`.

**3. Each test gets its own config home.**

```ts
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(cleanupConfigHome));
});

async function makeIsolatedConfigHome(): Promise<string> {
  const dir = await mkTempConfigHome();
  tempDirs.push(dir);
  return dir;
}
```

- One `XDG_CONFIG_HOME` per test, drained in `afterEach`. Sharing a config home across tests leaks profile state and is a flake source.

**4. Never mutate snapshot state.**

- The `/api/testing/snapshot` and `/api/testing/restore` endpoints are reserved for `tests/e2e/setup/bootstrap.ts`. A test that calls them corrupts every other test in the run.
- If your test mutates server state (creates a card, runs a transform), assume the next test sees that state. Either clean up at the end of the `it`, or design the assertion to be resilient.

**5. Use `parseJson` for `--json` output, not `JSON.parse + Zod.parse`.**

The schema is the contract. Import it from the production source — never redeclare in the test:

```ts
import { LoginResult } from "../../src/commands/auth/login";
import { parseJson } from "../../src/runtime/json";

const result = parseJson(login.stdout, LoginResult);
expect(result).toEqual({ profile: "default", ...});
```

If the command emits a domain resource, import the `<Resource>Compact` schema from `src/domain/<r>.ts`. Tests reuse production schemas; copying the shape into the test is silent drift the type-checker can't catch.

**6. License token: opaque only.**

If your test exercises EE features that need the dev license token:

- Read its existence via `process.env["MB_PREMIUM_EMBEDDING_TOKEN"] === undefined`. **Never read the value** to log/assert/debug it.
- Pass it to the CLI only as opaque stdin to `runCli({ stdin })`. Never echo it. Never `expect(...).toContain(token)`. Never include it in a snapshot.
- Use `mb_dev_…` dummy tokens for storage-roundtrip tests; only the EE-integration suite ever threads the real value, and only as opaque stdin.

**7. Resolving the base URL.**

```ts
import { resolveE2EBaseUrl } from "./defaults";
```

- `bootstrap.baseUrl` is normally what you want (it's already resolved). Only call `resolveE2EBaseUrl()` directly when constructing a URL that does not flow through bootstrap.

## Skeleton

```ts
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { LoginResult } from "../../src/commands/auth/login";
import { parseJson } from "../../src/runtime/json";

import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";

describe("<noun> e2e", () => {
  let bootstrap: E2EBootstrap;
  const tempDirs: string[] = [];

  beforeAll(async () => {
    bootstrap = await readBootstrap();
  });

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(cleanupConfigHome));
  });

  async function makeIsolatedConfigHome(): Promise<string> {
    const dir = await mkTempConfigHome();
    tempDirs.push(dir);
    return dir;
  }

  it("does the thing", async () => {
    const configHome = await makeIsolatedConfigHome();

    const result = await runCli({
      args: ["<noun>", "<verb>", "--json"],
      configHome,
      env: {
        METABASE_URL: bootstrap.baseUrl,
        METABASE_API_KEY: bootstrap.adminApiKey,
      },
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout /* schema from src/commands or src/domain */)).toEqual({
      // ...
    });
  });
});
```

## Running it locally

Prerequisites — once a day, ~1 minute:

```
bun run build
bun run e2e:up
bun run e2e:bootstrap
```

Per iteration:

```
bun run test:e2e            # one-shot
bun run test:e2e:watch      # watch mode; Metabase stays up between runs
```

Stack control: `bun run e2e:up`, `bun run e2e:down` (wipes volumes), `bun run e2e:logs`.

## Step N − 1 — Self-grep before declaring done (mandatory)

Run each of these against the file you just wrote. Any hit must be fixed; then re-run.

```sh
# Forbidden imports / direct calls:
rg -n "from\s+\"execa\"|from\s+\"node:child_process\"|from\s+\"child_process\"" tests/e2e/<noun>.e2e.test.ts && echo FAIL || echo OK
rg -n "\bspawn\(|\bexec\(|\bexecFile\(" tests/e2e/<noun>.e2e.test.ts && echo FAIL || echo OK
rg -n "\bfetch\s*\(" tests/e2e/<noun>.e2e.test.ts && echo FAIL || echo OK

# No mocks in e2e:
rg -n "vi\.(mock|spyOn|hoisted|fn)\b" tests/e2e/<noun>.e2e.test.ts && echo FAIL || echo OK

# Schema discipline:
rg -n "JSON\.parse\(" tests/e2e/<noun>.e2e.test.ts && echo FAIL || echo OK   # use parseJson
rg -n "const\s+Bootstrap\s*=" tests/e2e/<noun>.e2e.test.ts && echo FAIL || echo OK   # never redeclare Bootstrap

# Env hygiene:
rg -n "env:\s*process\.env|\.\.\.process\.env" tests/e2e/<noun>.e2e.test.ts && echo FAIL || echo OK

# Hard-coded creds / URLs:
rg -n "http://localhost" tests/e2e/<noun>.e2e.test.ts && echo FAIL || echo OK   # use bootstrap.baseUrl or resolveE2EBaseUrl()
rg -n "mb_api_key_|mb_dev_" tests/e2e/<noun>.e2e.test.ts && echo FAIL || echo OK   # use bootstrap.adminApiKey

# Snapshot endpoints are bootstrap-only:
rg -n "/api/testing/(snapshot|restore)" tests/e2e/<noun>.e2e.test.ts && echo FAIL || echo OK

# License token: existence only, never read the value:
rg -n "process\.env\[\"MB_PREMIUM_EMBEDDING_TOKEN\"\]" tests/e2e/<noun>.e2e.test.ts | rg -v "=== undefined" && echo FAIL || echo OK
```

Replace `<noun>` with your actual file name.

## Step N — Runnable verification (mandatory)

Type-check is required and cheap; the suite itself is opt-in (slow, brings up docker).

```sh
npx tsc --noEmit
```

Must exit 0. If you ran the suite, also include:

```sh
bun run test:e2e tests/e2e/<noun>.e2e.test.ts
```

If you did **not** run the e2e suite (it requires `bun run e2e:up && bun run e2e:bootstrap` and starts containers), say so explicitly — do not claim "passed e2e" if you only ran `tsc`.

## Sanity checks before declaring done

- [ ] Step 0 (read existing e2e file + harness) was actually performed.
- [ ] File path is `tests/e2e/<noun>.e2e.test.ts` (note `.e2e.test.ts`).
- [ ] Imports `runCli`, `mkTempConfigHome`, `cleanupConfigHome` from `./run-cli`. No `execa`/`child_process`/`fetch` import.
- [ ] Reads creds via `readBootstrap()`. No hard-coded API keys, no `Bootstrap` schema redeclaration, no setup-wizard call.
- [ ] No `vi.mock` / `vi.spyOn` / `vi.hoisted` / `vi.fn` anywhere in the file.
- [ ] No `process.env` spread into `runCli({ env: ... })`. Only the explicit keys the test needs.
- [ ] Per-test `makeIsolatedConfigHome()` pattern with `tempDirs` + `afterEach` cleanup.
- [ ] `--json` assertions go through `parseJson(stdout, <Schema>)` where `<Schema>` is imported from `src/commands/...` or `src/domain/...`.
- [ ] Does not call `/api/testing/snapshot` or `/api/testing/restore`.
- [ ] If license-touching: token only as opaque stdin; existence check via `=== undefined`; no logging/snapshotting/asserting on the value.
- [ ] Self-grep step ran clean (no FAIL lines).
- [ ] `npx tsc --noEmit` exited 0.
- [ ] If e2e suite was run, it was run after `bun run e2e:up && bun run e2e:bootstrap`. If it was NOT run, that is stated explicitly.

If any box is unchecked, the test is unfinished — do not report it as done. State explicitly which box is unchecked and continue working.
