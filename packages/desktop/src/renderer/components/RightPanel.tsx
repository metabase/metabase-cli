import { Maximize2, Minimize2, PanelRight } from "lucide-react";
import type { ReactElement } from "react";

import type { ConnectionState } from "../../contracts/connection";
import type { SessionIndexEntry, SessionSnapshot } from "../../contracts/session";
import type { Theme } from "../../contracts/settings";
import { cn } from "@/cn";

import { ChangesPanel } from "./Changes";
import { FilesPanel } from "./FilesPanel";
import { MetabasePanel } from "./MetabasePanel";
import { Button } from "./ui/button";
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

export type RightTab = "changes" | "files" | "metabase";

interface RightPanelProps {
  readonly tab: RightTab;
  readonly snapshot: SessionSnapshot | null;
  readonly sessions: readonly SessionIndexEntry[];
  readonly connection: ConnectionState | null;
  readonly theme: Theme;
  readonly expanded: boolean;
  readonly onTab: (tab: RightTab) => void;
  readonly onExpand: () => void;
  readonly onCollapse: () => void;
  readonly onOpenSettings: () => void;
  readonly onMention: (sessionId: string, path: string) => void;
}

function isRightTab(value: unknown): value is RightTab {
  return value === "changes" || value === "files" || value === "metabase";
}

export function RightPanel({
  tab,
  snapshot,
  sessions,
  connection,
  theme,
  expanded,
  onTab,
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
        value={tab}
        onValueChange={(value) => {
          if (isRightTab(value)) {
            onTab(value);
          }
        }}
        className="flex-1"
      >
        <WindowStrip edge="trailing" className="justify-between gap-2 px-3">
          <TabsList>
            <TabsTab value="changes">Changes</TabsTab>
            <TabsTab value="files">Files</TabsTab>
            <TabsTab value="metabase">Metabase</TabsTab>
          </TabsList>
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
        <TabsPanel value="files">
          {snapshot === null ? null : (
            <FilesPanel
              key={snapshot.session.id}
              snapshot={snapshot}
              theme={theme}
              onMention={(path) => {
                onMention(snapshot.session.id, path);
              }}
            />
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
      </Tabs>
    </aside>
  );
}
