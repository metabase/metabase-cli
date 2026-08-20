import { defineCommandGroup } from "../group";

export default defineCommandGroup({
  name: "content-translation",
  description: "Download or replace the content translation dictionary",
  subCommands: {
    download: () => import("./download").then((mod) => mod.default),
    upload: () => import("./upload").then((mod) => mod.default),
  },
});
