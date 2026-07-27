---
name: add-e2e-test
description: Add an end-to-end test that drives the built CLI against a real Metabase via docker compose. Use whenever the user asks to "add an e2e test for `<command>`", "wire `<noun> <verb>` into tests/e2e", "cover the new command end-to-end", or anything that creates a file under `tests/e2e/`. Loading this skill is mandatory before generating any `tests/e2e/**/*.e2e.test.ts` file or modifying the e2e harness — the runtime contract is strict and easy to violate.
---

# add-e2e-test

The e2e tier exists to run the **built `packages/cli/dist/cli.mjs`** against a real Metabase, with no mocks. Subtle violations of the harness contract corrupt shared state for every other test in the run. Reading this is required before generating any e2e file.

The tier is workspace-wide: it lives at the repo root under `tests/e2e/`, not inside either package, because it exercises the shipped binary rather than a package's source. Unit tests are the mirror image — they sit beside the code under `packages/<p>/src/**/*.test.ts`.

## Step 0 — Pre-flight (mandatory, do not skip)

Before generating anything, anchor to the existing harness:

1. `ls tests/e2e/` — see the layout and existing nouns.
2. Read **one** existing e2e test end-to-end (e.g. `tests/e2e/auth.e2e.test.ts`).
3. Read the harness modules every later step reaches for:
   - `tests/e2e/run-cli.ts` — the only sanctioned way to invoke the CLI.
   - `tests/e2e/bootstrap-data.ts` — the `Bootstrap` schema you must NOT redeclare.
   - `tests/e2e/cli-error.ts` — `cliErrorMessage` / `cliErrorCategory`, how you assert on stderr.
   - `tests/e2e/defaults.ts` — base URL, stack id, snapshot name.
   - `tests/e2e/server-gate.ts` — `requireServer` / `serverVersionBelow`, how a suite skips.
   - `tests/e2e/seed/seeded.ts` and `tests/e2e/seed/ids.ts` — discovered and fixed entity ids.

Skip this and you will reinvent harness pieces that already exist, or redeclare the bootstrap schema and silently drift from the writer.

## When to add an e2e test

- A new command was added under `packages/cli/src/commands/<noun>/<verb>.ts`. Every new command needs an e2e test.
- An existing command grew a flag, output mode, or behavior that unit tests cannot exercise (real network round-trip, real auth flow, real polling).

If the command can be fully covered by colocated `packages/<p>/src/**/*.test.ts` unit tests, do **not** add an e2e test — the unit tier is faster and more deterministic.

## Where the test lives

- Path: `tests/e2e/<noun>.e2e.test.ts` (one file per noun, multiple `it`s for verbs/flows).
- File name suffix is **`.e2e.test.ts`** — the vitest project glob requires this. `.test.ts` alone will not run in the e2e tier.

## The runtime contract

You must follow all of these. Each rule has bitten the harness before.

**1. Invoke the CLI only via `runCli`.**

```ts
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";
```

- `runCli({ args, configHome, env, stdin, timeoutMs })` spawns `node packages/cli/dist/cli.mjs` via `execa` with an isolated `XDG_CONFIG_HOME`, `MB_CLI_DISABLE_KEYRING=1`, and stripped env (no inherited `MB_*`/`METABASE_*`).
- **Do not** import `execa`, `child_process`, `node:child_process`, or `spawn` directly.
- **Do not** call `fetch` against the Metabase instance. Bootstrap owns network setup; tests drive the CLI.
- **Do not** spread `process.env` into the `env` param. `env: process.env`, `env: { ...process.env, ... }`, and friends defeat the entire isolation guarantee — they let developer-shell `METABASE_*` leak into the test. Pass only the explicit keys you need.

**1a. No mocks in the e2e tier.**

The whole point of e2e is end-to-end with real I/O. These are forbidden anywhere under `tests/e2e/`:

- `vi.mock(...)`
- `vi.spyOn(...)`
- `vi.hoisted(...)`
- `vi.fn(...)` to stand in for a real dep

If you find yourself wanting a mock, you are in the wrong tier — write a unit test colocated under `packages/<p>/src/`.

**2. Read admin credentials only via `readBootstrap()`.**

```ts
import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";

let bootstrap: E2EBootstrap;
beforeAll(async () => {
  bootstrap = await readBootstrap();
});
```

- The `Bootstrap` schema lives in `tests/e2e/bootstrap-data.ts`. **Never redeclare it.** If you need a new field, edit the schema there — the writer (`tests/e2e/setup/bootstrap.ts`) consumes the same type, so drift is mechanically prevented.
- The seeded `bootstrap.adminApiKey` authenticates as a synthetic api-key user (email `api-key-user-…@api-key.invalid`). For tests that need a real human admin, run the in-process OAuth login harness (`tests/e2e/setup/oauth-harness.ts` — `consentingBrowser` with `bootstrap.admin`; OAuth-capable servers only, gate with `requireOAuthServer("<lane>")`) and **explain in the test name why** — don't paper over it.
- **Never invoke the setup wizard from a test.** That mutates global state. Bootstrap runs once per `bun run test:e2e` via `tests/e2e/setup/global-setup.ts`.
- **Never hard-code an API key.** Always read from `bootstrap`.

**2a. Seeded entity ids come from `SEEDED`, never a literal.**

```ts
import { SEEDED } from "./seed/seeded";

const tableId = SEEDED.tables.orders;
```

- `tests/e2e/seed/seeded.ts` exposes the ids the bootstrap **discovered** by name (warehouse db, collection, card, dashboard, dashcard, plus warehouse tables and fields). Ids are not stable across stacks — a literal `5` passes on your machine and fails in the matrix.
- Constants that genuinely are fixed by Metabase itself (the `All Users` and `Administrators` group ids) live in `tests/e2e/seed/ids.ts`. Import from there rather than inlining the number.

**2b. Gate the suite on server capability.**

```ts
import { requireServer } from "./server-gate";

const skipReason = requireServer("transform › transform e2e", { minVersion: 59 });

describe.skipIf(skipReason !== null)("transform e2e", () => {
```

- If the command under test declares `capabilities` above the baseline `{ minVersion: 58 }` — a higher major, or a `tokenFeature` like `remote_sync` or `library` — the suite must gate itself. `requireServer` feeds the persisted server probe through the production `checkCapabilities` and returns a skip reason (or `null`). Its first argument is the lane label naming the describe or test the gate guards; an unmet gate appends it to `.gate-skips.<stack>.json`, which the closing block prints so a skipped lane is reported rather than counted as a passing one.
- The point is that a lane **passes or skips**, never fails, on a server that cannot satisfy the command. A suite that hits HTTP 402 or 404 because nobody gated it is a broken lane, not a real failure.

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

**4. Every test starts from the restored snapshot.**

`vitest.workspace.ts` registers `setupFiles: ["tests/e2e/setup/restore-each.ts"]` for the e2e project, whose `beforeEach` restores the app-db snapshot (`resetToCliDefault`) and the warehouse (`resetWarehouse`) before **every** test. Two consequences:

- **Never rely on state a previous `it` created.** Each test builds the entities it needs, inside itself. A test that passes only when its neighbour ran first will fail the moment either is renamed, skipped, or filtered by `-t`.
- **No manual cleanup.** Don't unwind a created card or transform at the end of the `it` — the restore does it. Teardown code that duplicates the harness is noise, and it hides the state leak it was written to fix.

The `/api/testing/snapshot` and `/api/testing/restore` endpoints belong to `tests/e2e/setup/**`. A test that calls them directly re-enters the restore path mid-run and corrupts the very isolation it was reaching for.

**5. Use `parseJson` for `--json` output, not `JSON.parse + Zod.parse`.**

The schema is the contract. Import it from the production source — never redeclare in the test. Client modules come in by package specifier; CLI modules come in by relative path from the repo root:

```ts
import { parseJson } from "@metabase/client/json";

import { LoginResult } from "../../packages/cli/src/commands/auth/login";

const result = parseJson(login.stdout, LoginResult);
expect(result).toEqual({ profile: "default", ...});
```

If the command emits a single domain resource, import the `<Resource>` / `<Resource>Compact` schema from `@metabase/client/domain/<r>`. **For list commands, import the `<Resource>ListEnvelope` from the command file itself** (`packages/cli/src/commands/<noun>/list.ts` exports it as a named const built from `listEnvelopeSchema(<Resource>Compact)`). Never redeclare a `z.object({ data, returned, offset, limit, total, has_more, next_offset, truncated })` envelope inline — the envelope shape is owned by `packages/cli/src/output/types.ts:listEnvelopeSchema` and threaded through the command's `outputSchema`. Tests reuse production schemas; copying any shape into the test is silent drift the type-checker can't catch.

Which package a schema belongs to is a boundary question, not a stylistic one. A Metabase API resource is client surface and lives in `packages/client/src/domain/`; a shape that exists only because a command renders it that way (`LoginResult`, `AuthStatus`, `<Resource>ListEnvelope`) is CLI surface and lives with its command. Import from wherever it actually is — do not mirror it into the other package to shorten the specifier.

**5b. Assertion strictness.** Every assertion is exact:

- **Parsed payloads:** one `toEqual({ ...full expected... })` over the parsed object — never a sequence of `expect(parsed.id).toBe(...)`, `expect(parsed.name).toBe(...)`. The whole point of `parseJson` is that the structure is now in your hands; pinning each field individually leaves the rest untested and lets a regression that flips an unchecked field pass silently.
- **Exit codes:** `expect(result.exitCode).toBe(<n>)` with the exact integer. Never `.not.toBe(0)`. The taxonomy is `packages/client/src/errors.ts`: `ConfigError` → 2, `CapabilityError` (`packages/client/src/version/preflight-error.ts`) → 2, `AbortError` → 130, everything else (`HttpError`, `ValidationError`, `NetworkError`, `TimeoutError`, `UnknownError`) → 1. A test that says "non-zero" doesn't distinguish "the right error fired" from "any failure at all".
- **Error strings:** the harness is never a TTY, so the CLI renders errors as a JSON envelope on stderr rather than plain text. Assert through `cliErrorMessage(result.stderr)` from `./cli-error`, which unwraps that envelope and hands back the human message:

  ```ts
  import { cliErrorMessage } from "./cli-error";

  expect(result.exitCode).toBe(2);
  expect(cliErrorMessage(result.stderr)).toContain('invalid id: "abc" (expected integer)');
  ```

  A raw `expect(result.stderr).toContain("…")` also works when the expected text is a plain substring, and plenty of suites use it that way. But `toBe` against raw stderr never matches — stderr carries the whole envelope, plus any leading `warn()` lines. And any message containing a quote, backslash, or newline **requires** `cliErrorMessage`, because the envelope JSON-escapes those characters, so the raw substring is absent from stderr. Never `toMatch(/.../i)` against stderr/stdout.

  Look up the literal message where it is raised — `packages/client/src/http/errors.ts` for HTTP status messages (a 404 produces `` `Not found: ${method} ${path}.` ``; the bare `"Not found."` in that file is the legacy plain-text body older servers send, used only to classify the error kind), `packages/cli/src/commands/<noun>/<verb>.ts` for `ConfigError` strings (e.g. `"--yes required to clear credentials non-interactively"`, `"verification failed: …"`), `packages/cli/src/commands/parse-integer.ts` for `"invalid id: …"`. Pinning the literal substring catches a refactor that swaps the message; a regex with `\d+` or `.*` does not.

- **Dynamic messages:** if the message contains a generated value (a byte count, a created id, a timestamp), build the expected string from the same data the production code consumed and assert with `toBe`/`toContain`. Don't paper over the dynamic part with a regex.

**5a. Command-list test parity.** When you add a new leaf command, update the literal `ALL_COMMANDS` list in `packages/cli/src/runtime/command-help.test.ts` to include the new entry (and remove any path you renamed/deleted). The index is generated by walking `packages/cli/src/main.ts`, so the contract test will fail until the literal matches the new tree.

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

import { parseJson } from "@metabase/client/json";

import { LoginResult } from "../../packages/cli/src/commands/auth/login";
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
        MB_URL: bootstrap.baseUrl,
        MB_API_KEY: bootstrap.adminApiKey,
      },
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(
      parseJson(result.stdout /* schema from @metabase/client/domain or the command file */),
    ).toEqual({
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

# Assertion strictness:
rg -n "\.not\.toBe\(0\)" tests/e2e/<noun>.e2e.test.ts && echo FAIL || echo OK   # use exact exitCode
rg -n "\.toMatch\(/" tests/e2e/<noun>.e2e.test.ts && echo FAIL || echo OK       # use toContain / toBe
```

Replace `<noun>` with your actual file name.

## Step N — Runnable verification (mandatory)

The gate is required and cheap; the e2e suite itself is opt-in (slow, brings up docker).

```sh
bun run check
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
- [ ] Seeded entity ids come from `SEEDED` (`./seed/seeded`) or `./seed/ids`; no literal id anywhere.
- [ ] If the command's `capabilities` are above `{ minVersion: 58 }`, the suite gates on `requireServer("<lane>", {...})` via `describe.skipIf`, with a lane label naming what the gate guards.
- [ ] No `vi.mock` / `vi.spyOn` / `vi.hoisted` / `vi.fn` anywhere in the file.
- [ ] No `process.env` spread into `runCli({ env: ... })`. Only the explicit keys the test needs.
- [ ] Per-test `makeIsolatedConfigHome()` pattern with `tempDirs` + `afterEach` cleanup.
- [ ] `--json` assertions go through `parseJson(stdout, <Schema>)` (`parseJson` from `@metabase/client/json`) where `<Schema>` is imported from `@metabase/client/domain/...` or `../../packages/cli/src/commands/...`.
- [ ] Does not call `/api/testing/snapshot` or `/api/testing/restore`.
- [ ] If license-touching: token only as opaque stdin; existence check via `=== undefined`; no logging/snapshotting/asserting on the value.
- [ ] Self-grep step ran clean (no FAIL lines).
- [ ] `bun run check` exited 0.
- [ ] If e2e suite was run, it was run after `bun run e2e:up && bun run e2e:bootstrap`. If it was NOT run, that is stated explicitly.

If any box is unchecked, the test is unfinished — do not report it as done. State explicitly which box is unchecked and continue working.
