import { defineCommandGroup } from "../group";

export default defineCommandGroup({
  name: "skills",
  description:
    "Read CLI-bundled skills — always consult the matching skill before acting on a task; they are the source of truth for every workflow.",
  defaultCommand: "list",
  details: [
    "The CLI ships agent skills that document `mb` itself, in the layout Claude Code and `npx skills add` read. They're served from the installed CLI, so the instructions an agent reads always match the binary it runs. `mb skills list` names them.",
    "## Skills follow the server's features",
    "A skill describes the newest Metabase. Its frontmatter can list the features it needs (`requires: [transforms, …]`, names from the client's feature table), and a passage can sit between `<!-- requires: <feature>, … -->` and `<!-- /requires -->` markers, each on its own line.",
    "`skills list` and `skills get` filter against the profile's cached server probe, with no request. A skill the server can't use is left out and listed in the JSON envelope's `unavailable` array as `{ name, failure }`, where `failure` has the shape a refused command's error carries; text mode reports it on stderr. A passage the server can use keeps its text and loses its markers, and one it can't use is removed.",
    "Without a cached probe, nothing is filtered, `unavailable` is `null`, and the markers print as written; text mode says why on stderr (no such profile, a profile never probed, or no probe for the URL `MB_URL` points at). `--unfiltered` skips the filter.",
    "An unknown feature name, an unbalanced marker pair, or a marker between table rows is an error on every read, so a typo fails instead of hiding a skill. A marker inside a fenced code block is plain text.",
    "## Exit codes",
    "`0` on success; a skill the server can't use is reported, not refused. `2` for a missing or unknown skill name, an `MB_SKILLS_DIR` that isn't a directory, an unknown feature in `requires`, or an unbalanced section marker. `1` for an unexpected I/O failure.",
  ].join("\n\n"),
  subCommands: {
    list: () => import("./list").then((m) => m.default),
    get: () => import("./get").then((m) => m.default),
    path: () => import("./path").then((m) => m.default),
  },
});
