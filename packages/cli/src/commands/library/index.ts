import { defineCommandGroup } from "../group";

export default defineCommandGroup({
  name: "library",
  description: "Curate the Metabase Library — publish trusted tables to its Data collection",
  details: [
    "## The Library holds trusted tables and metrics",
    'The Library is a governed subtree of collections under a `library` root. Its `library-data` collection, "Data", holds published tables, and its `library-metrics` collection, "Metrics", holds official metrics.',
    "Only admins and data analysts can curate the Library: Curate permission on a collection isn't enough to publish tables. A table's `is_published` field, in [mb table get](table.md#mb-table-get) and [mb table list](table.md#mb-table-list), says whether it is published.",
  ].join("\n\n"),
  skills: [
    { skill: "core", purpose: "publish tables to the Library" },
    { skill: "data-workflow", purpose: "which tables are worth publishing" },
  ],
  subCommands: {
    get: () => import("./get").then((m) => m.default),
    create: () => import("./create").then((m) => m.default),
    publish: () => import("./publish").then((m) => m.default),
    unpublish: () => import("./unpublish").then((m) => m.default),
  },
});
