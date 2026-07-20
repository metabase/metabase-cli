# Metabase CLI monorepo

Bun-workspaces monorepo hosting:

- [`packages/cli`](packages/cli) — `@metabase/cli`, the `mb` command-line interface for Metabase. See its [README](packages/cli/README.md) for usage.
- [`packages/agent`](packages/agent) — `@metabase/agent`, a Metabase agent built on top of the CLI.

## Development

```sh
bun install
bun run build          # delegates to packages/cli
bun run test
bun run typecheck
bun run lint
```

Root scripts delegate to `packages/cli`; equivalently, run `bun run <script>` from inside the package. Contributor docs live in [CLAUDE.md](CLAUDE.md).

## License

[AGPL-3.0](LICENSE)
