import { defineCommandGroup } from "../group";

export default defineCommandGroup({
  name: "transform-tag",
  description: "Manage Metabase transform tags",
  details: [
    "## Tags group transforms and jobs",
    "A transform or a job names its tags by id in its `tag_ids` field (see [`mb transform update`](transform.md#mb-transform-update) and [`mb transform-job update`](transform-job.md#mb-transform-job-update)). The four built-in tags, `hourly`, `daily`, `weekly` and `monthly`, drive the four built-in jobs.",
    "There's no command to get one tag by id: read it from [`mb transform-tag list`](#mb-transform-tag-list).",
  ].join("\n\n"),
  skills: [{ skill: "transform", purpose: "tags that drive job schedules" }],
  subCommands: {
    list: () => import("./list").then((mod) => mod.default),
    create: () => import("./create").then((mod) => mod.default),
    update: () => import("./update").then((mod) => mod.default),
    delete: () => import("./delete").then((mod) => mod.default),
  },
});
