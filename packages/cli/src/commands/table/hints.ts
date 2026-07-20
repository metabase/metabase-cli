export function tableFieldsOversizeHint(tableId: number): string {
  return `use \`mb table fields ${tableId}\` — list output truncates gracefully instead of failing`;
}
