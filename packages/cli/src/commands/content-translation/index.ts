import { defineCommandGroup } from "../group";

export default defineCommandGroup({
  name: "content-translation",
  description: "Download or replace the content translation dictionary",
  details: [
    "## Admins only, and separate from Remote Sync",
    "Both commands need an admin credential. The dictionary is independent of Remote Sync: importing or exporting a Git repository with [`mb git-sync import`](git-sync.md#mb-git-sync-import) or [`mb git-sync export`](git-sync.md#mb-git-sync-export) doesn't deploy it.",
  ].join("\n\n"),
  subCommands: {
    download: () => import("./download").then((mod) => mod.default),
    upload: () => import("./upload").then((mod) => mod.default),
  },
});
