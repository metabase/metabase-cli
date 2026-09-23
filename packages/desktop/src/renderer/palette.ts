import type { SessionIndexEntry } from "../contracts/session";
import type { RightTab } from "@/components/RightPanel";
import type { KeyAction } from "@/keybindings";
import { visibleSessions } from "@/session-list";
import { SETTINGS_SECTIONS, SETTINGS_SECTION_TITLES } from "@/settings-sections";
import type { SettingsSection } from "@/settings-sections";

interface NewSessionCommand {
  readonly kind: "new-session";
}

interface OpenSessionCommand {
  readonly kind: "open-session";
  readonly sessionId: string;
}

interface OpenSettingsCommand {
  readonly kind: "open-settings";
  readonly section: SettingsSection;
}

interface ToggleSidePanelCommand {
  readonly kind: "toggle-side-panel";
}

interface ShowTabCommand {
  readonly kind: "show-tab";
  readonly tab: RightTab;
}

export type PaletteCommand =
  | NewSessionCommand
  | OpenSessionCommand
  | OpenSettingsCommand
  | ToggleSidePanelCommand
  | ShowTabCommand;

export type PaletteGroup = "Actions" | "Sessions";

export interface PaletteItem {
  readonly id: string;
  readonly group: PaletteGroup;
  readonly label: string;
  readonly detail: string | null;
  readonly binding: KeyAction | null;
  readonly command: PaletteCommand;
}

const IN_PLACE_DETAIL = "in the repository";

function action(
  id: string,
  label: string,
  binding: KeyAction | null,
  command: PaletteCommand,
): PaletteItem {
  return { id, group: "Actions", label, detail: null, binding, command };
}

const SETTINGS_ACTIONS: readonly PaletteItem[] = SETTINGS_SECTIONS.map((section) =>
  action(
    `settings-${section}`,
    `${SETTINGS_SECTION_TITLES[section]} settings`,
    section === "metabase" ? "open-settings" : null,
    { kind: "open-settings", section },
  ),
);

const ACTIONS: readonly PaletteItem[] = [
  action("new-session", "New session", "new-session", { kind: "new-session" }),
  action("show-changes", "Show changes", null, { kind: "show-tab", tab: "changes" }),
  action("show-files", "Show files", null, { kind: "show-tab", tab: "files" }),
  action("show-metabase", "Show Metabase", null, { kind: "show-tab", tab: "metabase" }),
  action("toggle-side-panel", "Show or hide the side panel", "toggle-changes", {
    kind: "toggle-side-panel",
  }),
  ...SETTINGS_ACTIONS,
];

function sessionItem(entry: SessionIndexEntry): PaletteItem {
  return {
    id: `session-${entry.id}`,
    group: "Sessions",
    label: entry.title,
    detail: entry.workspace.kind === "worktree" ? entry.workspace.branch : IN_PLACE_DETAIL,
    binding: null,
    command: { kind: "open-session", sessionId: entry.id },
  };
}

function wordsOf(query: string): readonly string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 0);
}

function actionMatches(item: PaletteItem, words: readonly string[]): boolean {
  const label = item.label.toLowerCase();
  return words.every((word) => label.includes(word));
}

// Actions lead because they are few and named; sessions follow in the sidebar's own order and
// match on the sidebar's own terms, so the palette never finds what the sidebar's search would not.
export function paletteItems(
  sessions: readonly SessionIndexEntry[],
  query: string,
): readonly PaletteItem[] {
  const words = wordsOf(query);
  const actions = ACTIONS.filter((item) => actionMatches(item, words));
  const matched = visibleSessions(sessions, { query: query.trim(), archived: false });
  return [...actions, ...matched.map(sessionItem)];
}

export function movedSelection(current: number, step: number, count: number): number {
  if (count === 0) {
    return 0;
  }
  return (((current + step) % count) + count) % count;
}
