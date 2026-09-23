import {
  FolderTree,
  Maximize2,
  Minimize2,
  PanelRight,
  Plus,
  TerminalSquare,
  X,
} from "lucide-react";
import type { ReactElement } from "react";

import type { ConnectionState } from "../../contracts/connection";
import type { SessionIndexEntry, SessionSnapshot } from "../../contracts/session";
import type { Theme } from "../../contracts/settings";
import { cn } from "@/cn";
import {
  FIXED_TABS,
  fixedTabTitle,
  openedTabTitle,
  type OpenedKind,
  type OpenedTab,
  type SideTabs,
} from "@/side-tabs";

import { ChangesPanel } from "./Changes";
import { FilesPanel } from "./FilesPanel";
import { MetabasePanel } from "./MetabasePanel";
import { TerminalPane } from "./TerminalPane";
import { Button } from "./ui/button";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "./ui/menu";
import { Tabs, TabsList, TabsPanel, TabsTab } from "./ui/tabs";
import { WindowStrip } from "./ui/window-strip";

export const CHANGES_TOGGLE_LABEL = "Show or hide the side panel";

interface SidePanelToggleProps {
  readonly onToggle: () => void;
}

// One control in one place: the open panel's strip holds it, and the closed panel leaves it in the
// window's trailing corner at the same spot.
export function SidePanelToggle({ onToggle }: SidePanelToggleProps): ReactElement {
  return (
    <Button variant="ghost" size="icon-sm" aria-label={CHANGES_TOGGLE_LABEL} onClick={onToggle}>
      <PanelRight aria-hidden />
    </Button>
  );
}

const EXPAND_LABEL = "Expand the side panel";
const RESTORE_LABEL = "Restore the side panel";

interface ExpandToggleProps {
  readonly expanded: boolean;
  readonly onToggle: () => void;
}

function ExpandToggle({ expanded, onToggle }: ExpandToggleProps): ReactElement {
  const label = expanded ? RESTORE_LABEL : EXPAND_LABEL;
  const Icon = expanded ? Minimize2 : Maximize2;
  return (
    <Button variant="ghost" size="icon-sm" aria-label={label} title={label} onClick={onToggle}>
      <Icon aria-hidden />
    </Button>
  );
}

const NEW_TAB_LABEL = "Open a tab";
const MIDDLE_BUTTON = 1;

interface RightPanelProps {
  readonly tabs: SideTabs;
  readonly snapshot: SessionSnapshot | null;
  readonly sessions: readonly SessionIndexEntry[];
  readonly connection: ConnectionState | null;
  readonly theme: Theme;
  readonly expanded: boolean;
  readonly onSelect: (value: string) => void;
  readonly onOpen: (kind: OpenedKind) => void;
  readonly onClose: (tab: OpenedTab) => void;
  readonly onExpand: () => void;
  readonly onCollapse: () => void;
  readonly onOpenSettings: () => void;
  readonly onMention: (sessionId: string, path: string) => void;
}

export function RightPanel({
  tabs,
  snapshot,
  sessions,
  connection,
  theme,
  expanded,
  onSelect,
  onOpen,
  onClose,
  onExpand,
  onCollapse,
  onOpenSettings,
  onMention,
}: RightPanelProps): ReactElement {
  return (
    <aside
      aria-label="Side panel"
      className={cn(
        "flex flex-col overflow-hidden bg-canvas",
        expanded ? "min-w-0 flex-1" : "panel-side shrink-0 border-l border-line",
      )}
    >
      <Tabs
        value={tabs.active}
        onValueChange={(value) => {
          if (typeof value === "string") {
            onSelect(value);
          }
        }}
        className="flex-1"
      >
        <WindowStrip edge="trailing" className="justify-between gap-2 px-3">
          <div className="flex min-w-0 items-center gap-1">
            <TabsList className="min-w-0 overflow-x-auto">
              {FIXED_TABS.map((fixed) => (
                <TabsTab key={fixed} value={fixed}>
                  {fixedTabTitle(fixed)}
                </TabsTab>
              ))}
              {tabs.opened.map((opened) => (
                <OpenedTabTab key={opened.id} tab={opened} onClose={onClose} />
              ))}
            </TabsList>
            <NewTabMenu disabled={snapshot === null} onOpen={onOpen} />
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <ExpandToggle expanded={expanded} onToggle={onExpand} />
            <SidePanelToggle onToggle={onCollapse} />
          </div>
        </WindowStrip>
        <TabsPanel value="changes" className="px-4 py-3">
          {snapshot === null ? null : (
            <ChangesPanel snapshot={snapshot} sessions={sessions} theme={theme} />
          )}
        </TabsPanel>
        <TabsPanel value="metabase">
          {connection === null ? null : (
            <MetabasePanel
              connection={connection}
              snapshot={snapshot}
              theme={theme}
              onOpenSettings={onOpenSettings}
              onMention={(path) => {
                if (snapshot !== null) {
                  onMention(snapshot.session.id, path);
                }
              }}
            />
          )}
        </TabsPanel>
        {snapshot === null
          ? null
          : tabs.opened.map((opened) => (
              <TabsPanel key={opened.id} value={opened.id} keepMounted={opened.kind === "files"}>
                {opened.kind === "files" ? (
                  <FilesPanel
                    snapshot={snapshot}
                    theme={theme}
                    onMention={(path) => {
                      onMention(snapshot.session.id, path);
                    }}
                  />
                ) : (
                  <TerminalPane tabId={opened.id} sessionId={snapshot.session.id} />
                )}
              </TabsPanel>
            ))}
      </Tabs>
    </aside>
  );
}

interface OpenedTabTabProps {
  readonly tab: OpenedTab;
  readonly onClose: (tab: OpenedTab) => void;
}

// The close control sits beside the tab rather than inside it, since a tab is itself a button.
function OpenedTabTab({ tab, onClose }: OpenedTabTabProps): ReactElement {
  const title = openedTabTitle(tab);
  return (
    <div className="group/tab flex shrink-0 items-center">
      <TabsTab
        value={tab.id}
        className="pr-1"
        onAuxClick={(event) => {
          if (event.button === MIDDLE_BUTTON) {
            onClose(tab);
          }
        }}
      >
        {title}
      </TabsTab>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={`Close ${title}`}
        title="Close"
        className="text-ink-3 opacity-0 group-hover/tab:opacity-100 focus-visible:opacity-100"
        onClick={() => {
          onClose(tab);
        }}
      >
        <X aria-hidden />
      </Button>
    </div>
  );
}

interface NewTabMenuProps {
  readonly disabled: boolean;
  readonly onOpen: (kind: OpenedKind) => void;
}

function NewTabMenu({ disabled, onOpen }: NewTabMenuProps): ReactElement {
  return (
    <Menu>
      <MenuTrigger
        disabled={disabled}
        render={
          <Button variant="ghost" size="icon-sm" aria-label={NEW_TAB_LABEL} title={NEW_TAB_LABEL} />
        }
      >
        <Plus aria-hidden />
      </MenuTrigger>
      <MenuContent align="start">
        <MenuItem
          onClick={() => {
            onOpen("files");
          }}
        >
          <FolderTree aria-hidden />
          Files
        </MenuItem>
        <MenuItem
          onClick={() => {
            onOpen("terminal");
          }}
        >
          <TerminalSquare aria-hidden />
          Terminal
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
