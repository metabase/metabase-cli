# Change: a migrated app, after release

Use this when the user asks to change an app this skill built, or a rule turns out wrong after release. Read the working files (`SKILL.md`, _Working files_), and touch only what the request reaches:

1. A change the user asked for is a decision (`D<n>`); a rule that was translated wrong is a fix. Update that widget's rules in `spec.md`.
2. Phase 6's branch step afresh (`SKILL.md`), before anything is written, asked first with the objects the change adds or changes: record the tracked branch in `plan.md`, and, when the target is another instance, a branch of this change's own, `agent/<slug>-<change>`, since the migration's branch has merged. Record it as the branch the work goes to.
3. Test first: a fresh fixture folder (`parity.md`, _The fixture folder_); for each transform it reaches, where transform tests are available, its kept test changed for the new rule (`mb transform-test get <id> --full --json`, then `update`), or, where none was kept, one written again from `spec.md`, each failing before the change; and the unit tests of the panels it reaches.
4. Change the transform, segment or measure, and the brief in `plan.md`; change the app to match with the data-app skills; run each transform it reaches once its test passes; a kept test stays, since `mb ci run` fails a transform that loses its last one; recompile the queries it reaches; update only their rows in `parity.md`.
5. Release as phase 9 once `parity.md` has no open rule, export and push asked first, then the handoff's parts that changed.
