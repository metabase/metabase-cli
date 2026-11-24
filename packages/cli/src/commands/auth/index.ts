import { defineCommandGroup } from "../group";

export default defineCommandGroup({
  name: "auth",
  description: "Authenticate against a Metabase instance",
  defaultCommand: "login",
  details: [
    "## Each profile has its own credential",
    "The CLI stores credentials per profile. The default profile is the one `$MB_PROFILE` names, or `default` when it's unset; pass `--profile <name>` (`-p`) to log in to, inspect or clear another one, or to point any other command at it.",
    "Each profile's URL, auth method and last probe go in `profiles.json` (mode `0600`) in `$XDG_CONFIG_HOME/metabase-cli` (`~/.config/metabase-cli` by default), or `%APPDATA%\\metabase-cli` on Windows. Secrets (an API key, or OAuth tokens) go in the OS keychain when there is one, and in the same file when there isn't.",
    "## A probe checks the credential and caches the server",
    "A probe reads the current user and the server's properties with the profile's credential. [`mb auth login`](#mb-auth-login) probes before it saves a credential, and [`mb auth list`](#mb-auth-list) probes every profile again. [`mb auth status`](#mb-auth-status) reads only what the last probe cached. Other commands use that cache too, and probe again before a check that an old answer could get wrong.",
    "A successful probe replaces the cached one and clears `lastFailure`. A failed probe records `lastFailure` and leaves the cached probe, the URL and the credential as they were.",
    "The text output of `login` and `status` shows the probed user, and all three commands show the role (`Admin` or `User`) and the Metabase version. The text output of `status` and `list` also shows the skew, which `login` gives only as JSON. `--json` adds `edition`, `tokenFeatures`, `knownRange` (the Metabase majors this CLI knows) and the `features` map that an explained refusal names. The skew is one of:",
    "| `skew` | Shown as |\n| --- | --- |\n| `supported` | supported |\n| `older-than-known` | older than this CLI supports (vN min) |\n| `newer-than-known` | newer than this CLI knows (vN max) |\n| `development` | development build (newer than every release) |",
  ].join("\n\n"),
  skills: [{ skill: "core", purpose: "authentication and named profiles" }],
  subCommands: {
    login: () => import("./login").then((m) => m.default),
    status: () => import("./status").then((m) => m.default),
    list: () => import("./list").then((m) => m.default),
    logout: () => import("./logout").then((m) => m.default),
  },
});
