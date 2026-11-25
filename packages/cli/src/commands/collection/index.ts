import { defineCommandGroup } from "../group";

export default defineCommandGroup({
  name: "collection",
  description: "Manage Metabase collections",
  details: [
    "## Collections are folders",
    'Collections are the folders that hold cards, dashboards, and other collections. [mb collection list](#mb-collection-list) includes the virtual root collection, **Our analytics**, whose id is the string `"root"`, beside the numeric ids of the others.',
    "## Official collections need an admin and a Pro or Enterprise plan",
    'Setting or clearing `authority_level` (`"official"`) needs an admin and the Official Collections feature; without the feature, the server answers 402. Sending the value the collection already has changes nothing, and works on any instance.',
  ].join("\n\n"),
  skills: [{ skill: "core", purpose: "collection ref forms and the transforms namespace" }],
  subCommands: {
    list: () => import("./list").then((mod) => mod.default),
    get: () => import("./get").then((mod) => mod.default),
    items: () => import("./items").then((mod) => mod.default),
    tree: () => import("./tree").then((mod) => mod.default),
    create: () => import("./create").then((mod) => mod.default),
    update: () => import("./update").then((mod) => mod.default),
    archive: () => import("./archive").then((mod) => mod.default),
  },
});
