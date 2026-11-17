# Handoff

However the migration ends, released or stopped. First, without asking:

- what `data-app` asks at handoff (_Dev preview_);
- delete the fixture folder (`plan.md`), and run each test `plan.md` lists as kept once more (`mb transform-test run <id>`): each passes;
- when build and target are one instance, check that the job for the tag `decisions.md` chose is active (`mb transform-job list`), and report it.

Then the handoff, in this order:

1. **Where the app is:** each app's URL on the build instance, `<build-url>/apps/<slug>`, and, when the target is another instance, `<target-url>/apps/<slug>`, which works after the import. Then the one thing that must happen before anyone but admins opens it, when there is one: the data access of step 2, or the row-level security of step 6.
2. **The steps left to the user:** only those that apply, in this order and renumbered from 1, each named exactly (_The steps_).
3. **The proof:** `parity.md`'s closing counts; the path of each app's `MIGRATION.md`, which a later change starts from; the `unverified` rules; how many rules have expected values that rest on your reading of the code alone, with no worked example from the source's own tests; each widget and scope pending a scoped user's check; the `D<n>` behind each accepted difference; the findings, each built as the source does it; the transform tests kept, each with its transform, which the export carries and anyone can run again (`mb transform-test run <id>`, writing temporary tables in the transform's database), and each deleted, with why, which `mb ci run` fails as untested; the widgets left out, with why; and, when actions moved, each action and how it moved, and each left in the source, with why (`records.md`).
4. **What was synced,** to which branch, at which commit.
5. **Official numbers:** none was made; any number the app shows can become an official Library metric, which the whole instance and Metabot see, when the user asks (`data-workflow`).
6. **The gaps:** anything a skill or command couldn't do, with the command and its output, and anything the app needs that only this machine has (an SDK installed from a local file), and the change to the source's backend each `BACKEND` action waits on.

Last, one question when there is anything to remove. Released: each transform you created that no kept widget reads, with its table and its test; on a yes, delete them (`transform`). Stopped before release: everything the migration created (transforms with their tables and tests, published tables, segments, measures, a Library created or synced) and each branch it switched to; on a yes, delete and unpublish them, and track again the branch `plan.md` recorded.

## The steps

1. When the work went to a branch other than the one the build instance tracked (both are in `plan.md`): review it and merge it into that tracked branch (`git-sync`, _After a `conflict` task_, step 5). When the target instance tracks another branch, that branch needs the work too.
2. When the target is another instance: if phase 9 neither found nor connected the source database there, connect it at `<target-url>/admin/databases/create` under the display name `inventory.md` recorded, then check that `mb db list --profile <target> --json --fields id,name,initial_sync_status` lists it with `complete` and that `mb table list --db-id <id> --profile <target>` lists the app's tables. When it's connected under another name, rename it, and never connect it twice. Either way, before the import, decide who may query it there: the import publishes the scoped tables to every group that can read the target's Library and has unrestricted view data on the database. Name those groups (Admin → Permissions), and either restrict their view data on the database until step 6 is done, or accept that they read every scope's rows until then.
3. When the target is another instance: import the branch the target tracks, once it has the work, then run the transforms (`--profile <target>`). The import creates each transform table's record, and the first run fills it.
4. When the target is another instance: its job for the tag `decisions.md` chose is active (`mb transform-job list --profile <target>`); without it, the app's numbers stop at the last run. That job runs every transform on the instance carrying the tag.
5. On the build instance, when the work went to another branch: `mb git-sync import --branch <the tracked branch plan.md recorded>` after the merge. When the target is another instance and the build instance's job for the tag is active, the build instance runs the transforms too: turn that job off there, which stops every transform carrying the tag, or accept the extra load. Where both instances' transforms write into the same database, turning it off is required: both would rewrite the same tables.
6. For scoped widgets, on the target instance, before any viewer is let in: row-level security, as `mapping.md`, _Row-level security at handoff_, sets out, naming each table and group. Until then, a scoped viewer sees every row.
7. On the target instance, each app's viewer groups (`data-app`, _Release_), a scoped group with its row-level-secured access.
8. When actions moved and the target is another instance: data actions on for the source database there (Admin → Databases → the database), which lets anyone with access to its actions write to it.
