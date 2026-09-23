import { defineCommandGroup } from "../group";

export default defineCommandGroup({
  name: "transform-tag",
  description: "Inspect Metabase transform tags",
  skills: [{ skill: "transform", purpose: "tags that drive job schedules" }],
  subCommands: {
    list: () => import("./list").then((mod) => mod.default),
  },
});
