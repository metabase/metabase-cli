import { defineCommandGroup } from "../group";

export default defineCommandGroup({
  name: "dashboard",
  description: "Manage Metabase dashboards",
  details: [
    "## Dashcards",
    "A dashboard groups cards (questions, models, metrics) into one layout. Each card on a dashboard is a dashcard: a placement with its own `id`, a position (`row`, `col`) and a size (`size_x`, `size_y`). Dashcards live in the dashboard's `dashcards` array.",
    "## Dashboard parameters (filters)",
    "A dashboard's `parameters` are its filter widgets. A body with an unknown parameter `type` is refused before sending, and the error lists every allowed type (`string/=`, `string/contains`, `number/between`, `date/range`, `category`, `id`, `temporal-unit`, …). To read the parameters, run `mb dashboard get <id> --fields parameters --json`.",
    "An edit replaces the whole `parameters` array, so read the current set, change it, and send all of it back with `mb dashboard update <id> --body '{\"parameters\":[…]}'`. A parameter the array leaves out is deleted.",
    "Each parameter's `id` is any non-blank string you choose, unique within the dashboard, such as its `slug` (`order_status`). It needn't be random, but [mb uuid](uuid.md) makes an opaque one if you want it. A dashcard's `parameter_mappings` bind a parameter to a card's column, and each mapping's `parameter_id` must match a parameter `id` exactly.",
    "## Card references are checked before sending",
    'Before [mb dashboard create](#mb-dashboard-create) or [mb dashboard update](#mb-dashboard-update) sends anything, it reads each card that a positive `card_id` in `dashcards` names. If a card doesn\'t exist, is archived, or can\'t be read, nothing is created or changed: the command prints `{ "ok": false, "errors": [{ "path", "message" }] }` on stdout, with one entry for each such dashcard and a `path` like `/dashcards/3/card_id`, and exits 2. To pass the check, fix the `card_id` values. The check reads the server, not a bundled schema, so there\'s no `--skip-validate`.',
    "If the follow-up update that applies `dashcards` and `tabs` after `mb dashboard create` fails, the error reads `dashboard <id> created but the follow-up update to dashboard <id> failed: <reason>; dashcards not applied`. The dashboard exists: send the layout again with `mb dashboard update <id> --body '{\"dashcards\":[…]}'`, or archive it with [mb dashboard archive](#mb-dashboard-archive).",
  ].join("\n\n"),
  skills: [
    {
      skill: "dashboard",
      purpose: "wiring filters, linked filters, cross-filtering, click behavior, tabs",
    },
    { skill: "visualization", purpose: "dashcard display and visualization_settings" },
    { skill: "core", purpose: "the 24-column dashcard grid layout" },
  ],
  subCommands: {
    list: () => import("./list").then((mod) => mod.default),
    get: () => import("./get").then((mod) => mod.default),
    cards: () => import("./cards").then((mod) => mod.default),
    "parameter-values": () => import("./parameter-values").then((mod) => mod.default),
    subscriptions: () => import("./subscriptions").then((mod) => mod.default),
    create: () => import("./create").then((mod) => mod.default),
    update: () => import("./update").then((mod) => mod.default),
    "update-dashcard": () => import("./update-dashcard").then((mod) => mod.default),
    copy: () => import("./copy").then((mod) => mod.default),
    verify: () => import("./verify").then((mod) => mod.default),
    archive: () => import("./archive").then((mod) => mod.default),
  },
});
