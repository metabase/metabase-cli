# Connect: add the source database to an instance

Phase 2, when the user chooses to connect another database or none on the build instance has the app's tables, and phase 9, when the target instance lacks it. The user adds the connection on Metabase's own admin page: its host, login and password never pass through you, and which database it opens, production or a copy, is theirs to choose. Connect one database at a time. `<profile>` below is that instance's profile, and `<url>` its address, from `mb auth status --profile <profile> --json | jq -r .url`.

## Before the page

In phase 2 nothing is asked first: the user chose it, or nothing matched, and a user who doesn't save one stops the migration. In phase 9, ask whether to connect it now, as a checkpoint of its own (`checkpoints.md`), and record the answer in `inventory.md`, _Data sources_; declined, the handoff's step 2 leaves it to the user (`handoff.md`). Then tell the user:

- the display name to give it: in phase 2, one you propose; in phase 9, the one `inventory.md` records. An instance matches imported content to its databases by name, so the name is the same on every instance;
- in phase 2, that the app shows the data of the database they enter, and that transforms write their tables into it, adding load on each run;
- the engine, when `inventory.md` records one;
- the login: transforms create their tables as that login, so it needs read access to the app's tables, the right to create tables in one schema, and, when actions move (`records.md`), the right to write the tables they write. Suggest a login of its own for Metabase rather than the app's;
- the host as Metabase reaches it: a Metabase running in Docker can't reach the machine's `localhost`. A database on the same machine, or in another Docker Compose project with its port published, is at `host.docker.internal`;
- in phase 9, who can query it once saved: each group gets the most restrictive access it already has on that instance's other databases. The handoff's step 2 (`handoff.md`) settles who may, before the import.

## Open it

Record the ids `mb db list --profile <profile> --json --fields id` lists. Open `<url>/admin/databases/create` with `open` on macOS, `xdg-open` on Linux or `start` on Windows, and print the address when none of them works. The user signs in there as an admin, saves the connection, and tells you when it's saved.

## Validate

When the user says it's saved, run the checks in order. On a failed check, say which one failed and what it found, and ask whether to fix it as that check says, or stop. After a fix, run the checks again from the first. Never go past a failed check.

1. **Saved.** `mb db list --profile <profile> --json --fields id,name,engine,initial_sync_status` lists an id that wasn't there before, of the engine `inventory.md` records when it records one. Metabase tests a connection before saving it and refuses one that fails, so no new id means nothing was saved: the fix opens `<url>/admin/databases/create`. Two new ids: the app's database is the one that passes check 3; ask only when both do. In a later round, check the id found here, or a new one when the user deleted it and added it again.
2. **Synced.** Its `initial_sync_status` reads `complete`. Read it again a few times over several minutes while it reads `incomplete`; still `incomplete` after that, ask whether to keep waiting or stop. `aborted` means the sync failed: the fix opens `<url>/admin/databases/<id>`.
3. **The app's tables.** It's a match as `SKILL.md`, phase 2, step 1 defines one. Otherwise sync its schema, and list the tables again over a few minutes before this check counts as failed: a sync started by hand leaves `initial_sync_status` at `complete`. In phase 9, the user starts the sync on `<url>/admin/databases/<id>`, since you write nothing on the target. Still a partial match: its two options as phase 2, step 3 gives them. A database that lists none of the tables is fixed on that page, never by connecting another one.
4. **The name,** in phase 9: exactly the one `inventory.md` records; another name: the user renames it on `<url>/admin/databases/<id>`. In phase 2, whatever name the user gave it is the one phase 2, step 4 records.

Once every check that applies passes, go back to phase 2, step 4; in phase 9, record the target's database id in `inventory.md` and go on.
