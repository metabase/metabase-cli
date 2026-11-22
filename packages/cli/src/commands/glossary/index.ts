import { defineCommandGroup } from "../group";

export default defineCommandGroup({
  name: "glossary",
  description: "Manage the Metabase glossary of business terms",
  details: [
    "## The glossary gives Metabot your business terms",
    "The glossary is the instance-wide list of business terms and their definitions. Its entries are listed on the Glossary pages of Data Studio and the Data Reference, and Metabot gets them as context, so a definition written once shapes every answer that uses the term.",
    "A server may restrict writes to admins and data analysts. There's no command to get one entry by id: use [mb glossary list](#mb-glossary-list) with `--search`.",
  ].join("\n\n"),
  subCommands: {
    list: () => import("./list").then((mod) => mod.default),
    create: () => import("./create").then((mod) => mod.default),
    update: () => import("./update").then((mod) => mod.default),
    delete: () => import("./delete").then((mod) => mod.default),
  },
});
