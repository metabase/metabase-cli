import { assertNever } from "../contracts/assert-never";

export type FixedTab = "changes" | "metabase";

export type OpenedKind = "files" | "terminal";

export interface OpenedTab {
  readonly kind: OpenedKind;
  readonly id: string;
  readonly serial: number;
}

// The side panel's tabs for one session. Changes and Metabase are always there; a person opens as
// many file browsers and terminals beside them as they like. `active` is a fixed tab or an opened
// tab's id.
export interface SideTabs {
  readonly opened: readonly OpenedTab[];
  readonly active: string;
}

export const FIXED_TABS: readonly FixedTab[] = ["changes", "metabase"];

export const INITIAL_SIDE_TABS: SideTabs = { opened: [], active: "changes" };

const KIND_TITLES: Readonly<Record<OpenedKind, string>> = {
  files: "Files",
  terminal: "Terminal",
};

export function fixedTabTitle(tab: FixedTab): string {
  switch (tab) {
    case "changes": {
      return "Changes";
    }
    case "metabase": {
      return "Metabase";
    }
    default: {
      return assertNever(tab);
    }
  }
}

// The first of a kind carries the bare name; later ones are numbered in the order they opened, and
// a number stays with its tab when an earlier one closes.
export function openedTabTitle(tab: OpenedTab): string {
  const title = KIND_TITLES[tab.kind];
  return tab.serial === 1 ? title : `${title} ${tab.serial}`;
}

function nextSerial(opened: readonly OpenedTab[], kind: OpenedKind): number {
  const serials = opened.filter((tab) => tab.kind === kind).map((tab) => tab.serial);
  return serials.length === 0 ? 1 : Math.max(...serials) + 1;
}

export function openTab(tabs: SideTabs, kind: OpenedKind, id: string): SideTabs {
  const tab: OpenedTab = { kind, id, serial: nextSerial(tabs.opened, kind) };
  return { opened: [...tabs.opened, tab], active: id };
}

// Closing the active tab moves to its left neighbour, or to Changes when it was the first.
export function closeTab(tabs: SideTabs, id: string): SideTabs {
  const index = tabs.opened.findIndex((tab) => tab.id === id);
  if (index === -1) {
    return tabs;
  }
  const opened = tabs.opened.filter((tab) => tab.id !== id);
  if (tabs.active !== id) {
    return { opened, active: tabs.active };
  }
  const neighbour = opened[index - 1];
  return { opened, active: neighbour === undefined ? INITIAL_SIDE_TABS.active : neighbour.id };
}

export function selectTab(tabs: SideTabs, value: string): SideTabs {
  const known =
    FIXED_TABS.some((tab) => tab === value) || tabs.opened.some((tab) => tab.id === value);
  return known ? { opened: tabs.opened, active: value } : tabs;
}
