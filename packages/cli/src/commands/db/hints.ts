export function fullRollupOversizeHint(dbId: number): string {
  return (
    `this database is too large for a full rollup — get the table map with ` +
    `\`mb db get ${dbId} --include tables\`, then fetch fields per table of interest with ` +
    `\`mb table fields <table-id>\``
  );
}

export function tableMapOversizeHint(dbId: number): string {
  return (
    `this database has too many tables for one map — traverse by schema with ` +
    `\`mb db schemas ${dbId}\` + \`mb db schema-tables ${dbId} <schema>\`, or find tables ` +
    `by name with \`mb search <term> --models table --db-id ${dbId}\``
  );
}
