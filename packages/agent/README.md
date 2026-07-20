# @metabase/agent

A Metabase agent built on [pi](https://pi.dev). It exposes 25 curated Metabase tools (`docs/toolset.md`) on top of pi's builtin coding tools, and they are its whole Metabase surface — what they do not reach is a gap to close with a tool (`docs/gaps.md`). What the model is told before its first turn — the prompt, the probed instance facts, and the skills — is `docs/prompt.md`.

It runs headless (`mb-agent run`) for scripts, and in pi's terminal UI (`mb-agent chat`) for an operator at a keyboard. Both build the same session; which of pi's interactive surface `chat` keeps is `docs/tui.md`. Both authenticate the same way: `docs/auth.md`.

## Environment

| Variable             | Purpose                                                                       |
| -------------------- | ----------------------------------------------------------------------------- |
| `MB_PROFILE`         | Which of the agent's profiles to run under (default `default`)                |
| `MB_URL`             | The Metabase instance to reach; outranks a profile                            |
| `MB_API_KEY`         | A Metabase API key; its permissions are the authorization boundary            |
| `AGENT_MODEL`        | `provider/model[:thinking]` (default `anthropic/claude-sonnet-4-5`)           |
| _the provider's key_ | Named per provider below; outranks the key `/login` stored in the OS keychain |
| `AGENT_MODELS_JSON`  | Optional path to a models.json describing an OpenAI-compatible endpoint       |

## Authentication

`mb-agent` authenticates separately from `mb`, and its credentials live in a store of their own — a keychain service and a profiles file the CLI never reads, and cannot clear. An agent must not act under the credential a human logged the terminal in with. `docs/auth.md` is the contract.

```sh
mb-agent auth login --url https://metabase.example.com   # browser login, or an API key
mb-agent auth list
```

`chat` also signs in on its own: it opens with no credential, and `/mb-login <url>` runs the browser flow from inside the TUI, storing a refreshing token and reconnecting the session in place.

`auth` is the CLI's own auth commands run against the agent's store, so the flags, the browser (OAuth) flow, the profile format and the token refresh are `mb`'s — the store is not. Resolution is `--url`/`--api-key`, then `MB_URL`/`MB_API_KEY`, then the profile's stored credential.

The `mb` the model runs in bash resolves the same identity: the harness names the store and the profile in the environment pi's bash executor inherits, so a stored credential is never copied into a child's environment, and an OAuth token is refreshed against the one keychain entry both processes share.

## Models

Switching model is `AGENT_MODEL` (or `--model`) plus that provider's key — or `/login` once, which stores the key in the OS keychain and needs no environment thereafter. Nothing else changes — same tools, same prompt, same skills.

Name no model and the agent runs the one it has a key for: Anthropic when it is credentialed, otherwise the first provider in the table below that is, on that provider's default model. Opening a TUI on a model whose provider has no key would fail on the first prompt — and pi only picks a model for you after `/login` if the session has none, so the failure would survive the login that was supposed to fix it.

| Provider        | `AGENT_MODEL`                                                | Key env var          |
| --------------- | ------------------------------------------------------------ | -------------------- |
| Anthropic       | `anthropic/claude-sonnet-4-5`                                | `ANTHROPIC_API_KEY`  |
| Z.AI (GLM)      | `zai/glm-5.1`                                                | `ZAI_API_KEY`        |
| Moonshot (Kimi) | `moonshotai/kimi-k2-thinking`                                | `MOONSHOT_API_KEY`   |
| OpenRouter      | `openrouter/z-ai/glm-5.2`, `openrouter/moonshotai/kimi-k2.6` | `OPENROUTER_API_KEY` |

OpenRouter reaches GLM and Kimi (and everything else it fronts) under one key: the id after the `openrouter/` prefix is OpenRouter's own, so `openrouter/z-ai/glm-5.2`, `openrouter/z-ai/glm-5.1`, `openrouter/moonshotai/kimi-k2.7-code` and `openrouter/moonshotai/kimi-k2-thinking` all work. Model ids come from pi's catalog, but an id pi has never heard of still resolves as long as the provider prefix is one of the four — pi builds a fallback model against the provider's endpoint. A trailing `:off|minimal|low|medium|high|xhigh|max` sets the thinking level (`openrouter/z-ai/glm-5.2:high`).

`run` fails at startup with exit 2 and a message naming the missing variable when the model has no key in the environment and none in the keychain, and whenever `AGENT_MODEL` is not `provider/model`. `chat` opens without a key — pi reports the miss on the first prompt and points at `/login`, which is the fix. The measured behaviour of each provider against the harness's own tool payloads is `docs/tasks/09-providers.md` in the repo root.

### Any other OpenAI-compatible endpoint

Describe it in a [models.json](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/models.md) and point `AGENT_MODELS_JSON` (or `--models-json`) at the file. The provider prefix in `AGENT_MODEL` then names the entry, and pi resolves its key from the `apiKey` reference rather than from the table above:

```json
{
  "providers": {
    "vllm": {
      "baseUrl": "http://localhost:8000/v1",
      "api": "openai-completions",
      "apiKey": "$VLLM_API_KEY",
      "compat": { "supportsDeveloperRole": false, "thinkingFormat": "qwen" },
      "models": [{ "id": "qwen3-coder", "reasoning": true }]
    }
  }
}
```

```sh
AGENT_MODELS_JSON=./models.json AGENT_MODEL=vllm/qwen3-coder VLLM_API_KEY=… mb-agent run "…"
```

The same file overrides a built-in provider — give `zai` a `baseUrl` and nothing else to route GLM through a proxy, keeping its catalog and its `ZAI_API_KEY`. The `compat` block is where OSS-endpoint quirks live (`thinkingFormat`, `requiresToolResultName`, `requiresAssistantAfterToolResult`, `cacheControlFormat`).

## The tools are the surface

The curated tools are the whole of how the agent reaches Metabase — authoring, querying, the data model, transforms, uploads, settings, git-sync and the Library. There is no second surface: `mb` is a separate product, it is not on the PATH pi's bash inherits, and it appears in neither the system prompt nor the skills. A Metabase capability no tool exposes is one the agent does not have, and the fix is a tool (`docs/gaps.md`), never a shell-out. pi's `bash` and file builtins stay, for the local work of authoring the query, layout and document files the tools take as arguments.

## Running

```sh
bun run --cwd packages/agent build
node packages/agent/dist/cli.mjs auth login --url http://localhost:3000
node packages/agent/dist/cli.mjs run "How many orders were placed last month?"
node packages/agent/dist/cli.mjs chat
```

Flags: `--profile name`, `--url url`, `--api-key key`, `--model provider/id[:thinking]`, `--models-json file`, `--cwd dir` (default: a fresh temp dir — the agent's filesystem sandbox and where `run_saved_question` exports land).

`run` streams the answer to stdout and names each tool call on stderr, so a pipe gets exactly the model's text. `chat` opens pi's TUI and needs a terminal; without one it exits 2 and points at `run`. The only things either mode writes are the credentials it is told to store — the agent's Metabase profile, and the provider key `/login` takes (`docs/auth.md`) — never a session, a transcript or a setting, and `docs/tui.md` is the record of what else pi's interactive surface brings.

## Embedding a session

`mb-agent` is a thin shell over `src/session.ts`, which a library caller uses directly:

```ts
import { createMetabaseConnection } from "./src/metabase/connection";
import { probeInstance } from "./src/metabase/probe";
import { resolveAgentModel } from "./src/models";
import { createMetabaseAgentSession } from "./src/session";

const { client, url } = await createMetabaseConnection({ profile: "prod" });
const instance = await probeInstance(client, url);
const model = resolveAgentModel({ env: process.env });
const session = await createMetabaseAgentSession({ cwd, client, instance, model });
await session.prompt("List the dashboards in the Marketing collection.");
```

`createMetabaseConnection` takes the CLI's `ConfigFlags` (`profile`, `url`, `apiKey`) and resolves them through the CLI's own resolver, against the agent's profile store. `resolveAgentModel` throws `ModelConfigError` when the model is malformed or its key is missing; the `mb-agent` shell turns that into exit 2. A session reads provider keys from the environment unless it is handed an `authStorage` — the keychain-backed store is `mb-agent`'s, not a library caller's (`docs/auth.md`). `client` is a `@metabase/cli/client` `Client`. Omit it and the session exposes only pi's builtins; pass `customTools` to replace the curated set outright. Omit `instance` and the prompt's instance block reads `unknown` on every line — the session still runs, and says so rather than inventing facts. `systemPrompt` overrides the built prompt entirely.

`createMetabaseAgentRuntime` takes the same options and returns pi's `AgentSessionRuntime` — the session plus the services under it, rebuilt through one factory whenever pi replaces the session. It is what a UI needs and what `chat` passes to `InteractiveMode`.

## Tests

- `bun run test` — unit (`src/**/*.test.ts`), no network. Includes the prompt's exact rendering and the assembled system prompt of a real (model-less) session, so the skills wiring is covered without a model key.
- `bun run test:smoke` — the smokes (`tests/smoke/`). `openai-compat.smoke.test.ts` needs nothing: it drives a full tool-calling session against a scripted local OpenAI-compatible endpoint, which is how the provider plumbing (runtime key on the wire, models.json registration, the `dashboard_write` ops array as an argument payload) is checked without spending a key. The rest run the harness against a live instance with whatever model `AGENT_MODEL` names — read (curated read chain), dashboard (ops-compiled write), admin (settings, transform jobs and timelines through their tools, with nothing reaching Metabase from bash), skills (does the model load the right `SKILL.md` before authoring). They need `MB_URL`, `MB_API_KEY`, and a provider key, and skip without them. Running them per provider is what fills the matrix in `docs/tasks/09-providers.md`.
