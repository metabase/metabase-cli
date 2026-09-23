import { Settings, TriangleAlert } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { ConnectionState } from "../../contracts/connection";
import type { PanelLayout } from "../../contracts/layout";
import type { ProviderHealthList } from "../../contracts/providers";
import type { AgentDefaults, SettingsView } from "../../contracts/settings";
import { assertNever } from "../../contracts/assert-never";
import { rde } from "@/bridge";
import { connectionWarning } from "@/connection-warning";
import type { NewSessionDraft } from "@/composer/draft";
import { EMPTY_DRAFT } from "@/composer/draft";
import { appendMention } from "@/composer/triggers";
import { actionFor } from "@/keybindings";
import type { OnboardingInput } from "@/onboarding";
import { canStartSession, onboardingSteps } from "@/onboarding";
import type { SidePanelState } from "@/layout";
import type { PaletteCommand } from "@/palette";
import { usePanels } from "@/panels";
import { keyPlatform } from "@/platform";
import type { RequestState } from "@/request";
import { requestFailure, useRequest } from "@/request";
import type { SessionsController } from "@/sessions";
import { useSessions } from "@/sessions";
import type { SettingsSection } from "@/settings-sections";
import {
  INITIAL_SIDE_TABS,
  closeTab,
  openTab,
  selectTab,
  type OpenedKind,
  type OpenedTab,
  type SideTabs,
} from "@/side-tabs";
import { closeTerminal } from "@/terminal/registry";

import { CommandPalette } from "./CommandPalette";
import { NewSessionComposer } from "./Composer";
import { OnboardingChecklist } from "./OnboardingChecklist";
import { RightPanel, SidePanelToggle } from "./RightPanel";
import { SessionView } from "./SessionView";
import { SettingsPage } from "./SettingsPage";
import { Sidebar } from "./Sidebar";
import { TreeResize } from "./TreeColumn";
import { UpdateToast } from "./UpdateToast";
import { Button } from "./ui/button";
import { ResizeHandle } from "./ui/resize-handle";
import { Spinner } from "./ui/spinner";
import { TrailingCorner, WindowStrip } from "./ui/window-strip";

interface Setup {
  readonly connection: ConnectionState;
  readonly providers: ProviderHealthList;
}

interface HomePage {
  readonly kind: "home";
}

interface SettingsPagePosition {
  readonly kind: "settings";
  readonly section: SettingsSection;
}

type Page = HomePage | SettingsPagePosition;

const HOME: Page = { kind: "home" };
const FIRST_SECTION: SettingsSection = "metabase";
const PRODUCT_NAME = "RDE";
const EMPTY_TEXT = "";
const SIDEBAR_HANDLE_LABEL = "Resize the sidebar";
const SIDE_PANEL_HANDLE_LABEL = "Resize the side panel";

function toggledSidePanel(current: SidePanelState): SidePanelState {
  return current === "closed" ? "open" : "closed";
}

function shownSidePanel(current: SidePanelState): SidePanelState {
  return current === "closed" ? "open" : current;
}

function restoredSidePanel(current: SidePanelState): SidePanelState {
  return current === "expanded" ? "open" : current;
}

interface ShellProps {
  readonly initialSettings: SettingsView;
}

export function Shell({ initialSettings }: ShellProps): ReactElement {
  const [settings, setSettings] = useState(initialSettings);
  const [page, setPage] = useState<Page>(HOME);
  const [sidePanel, setSidePanel] = useState<SidePanelState>("open");
  const [sideTabs, setSideTabs] = useState<ReadonlyMap<string, SideTabs>>(new Map());
  const nextTabNumber = useRef(1);
  const [newDraft, setNewDraft] = useState<NewSessionDraft>(EMPTY_DRAFT);
  const [drafts, setDrafts] = useState<ReadonlyMap<string, string>>(new Map());
  const [promptFocusRequests, setPromptFocusRequests] = useState(0);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { state: setup, send: sendSetup, update: updateSetup } = useRequest<Setup>();
  const sessions = useSessions();
  const { state: layoutSave, send: sendLayout } = useRequest<SettingsView>();

  const changeLayout = useCallback(
    (layout: PanelLayout): void => {
      setSettings((current) => ({ ...current, layout }));
      void sendLayout(() => rde.settingsSetLayout(layout));
    },
    [sendLayout],
  );

  const panels = usePanels({
    layout: settings.layout,
    sidePanel,
    onLayout: changeLayout,
  });
  const layoutFailure = requestFailure(layoutSave);
  // An expanded side panel takes the chat's place and leaves the sidebar where it is.
  const expanded = sidePanel === "expanded";

  const loadSetup = useCallback((): void => {
    void sendSetup(async () => ({
      connection: await rde.connectionRead(),
      providers: await rde.providersRead(),
    }));
  }, [sendSetup]);

  useEffect(loadSetup, [loadSetup]);

  const openSettings = useCallback((section: SettingsSection): void => {
    setPage({ kind: "settings", section });
  }, []);

  const closeSettings = useCallback((): void => {
    setPage(HOME);
  }, []);

  const applyConnection = useCallback(
    (connection: ConnectionState): void => {
      updateSetup((current) => ({ ...current, connection }));
    },
    [updateSetup],
  );

  useEffect(() => rde.onConnectionState(applyConnection), [applyConnection]);

  const applyProviders = useCallback(
    (providers: ProviderHealthList): void => {
      updateSetup((current) => ({ ...current, providers }));
    },
    [updateSetup],
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent): void => {
      const pressed = actionFor(event, "global", keyPlatform());
      if (pressed === null || paletteOpen || event.defaultPrevented) {
        return;
      }
      switch (pressed) {
        case "new-session": {
          event.preventDefault();
          setPage(HOME);
          sessions.leave();
          return;
        }
        case "open-palette": {
          event.preventDefault();
          setPaletteOpen(true);
          return;
        }
        case "toggle-changes": {
          event.preventDefault();
          setSidePanel(toggledSidePanel);
          return;
        }
        case "open-settings": {
          event.preventDefault();
          openSettings(FIRST_SECTION);
          return;
        }
        case "close-topmost": {
          setPage(HOME);
          setSidePanel(restoredSidePanel);
          return;
        }
        case "send":
        case "send-and-draft":
        case "newline":
        case "blur": {
          return;
        }
        default: {
          assertNever(pressed);
        }
      }
    },
    [openSettings, paletteOpen, sessions],
  );

  // On the window rather than the root element, so a shortcut works before anything has focus,
  // which is how the app opens.
  useEffect(() => {
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onKeyDown]);

  const snapshotId = sessions.snapshot === null ? null : sessions.snapshot.session.id;
  const activeTabs =
    snapshotId === null ? INITIAL_SIDE_TABS : (sideTabs.get(snapshotId) ?? INITIAL_SIDE_TABS);

  const changeTabs = useCallback(
    (change: (tabs: SideTabs) => SideTabs): void => {
      if (snapshotId === null) {
        return;
      }
      setSideTabs((current) =>
        new Map(current).set(snapshotId, change(current.get(snapshotId) ?? INITIAL_SIDE_TABS)),
      );
    },
    [snapshotId],
  );

  const openSideTab = useCallback(
    (kind: OpenedKind): void => {
      const id = `${kind}-${nextTabNumber.current}`;
      nextTabNumber.current += 1;
      setSidePanel(shownSidePanel);
      changeTabs((tabs) => openTab(tabs, kind, id));
    },
    [changeTabs],
  );

  const closeSideTab = useCallback(
    (tab: OpenedTab): void => {
      if (tab.kind === "terminal") {
        closeTerminal(tab.id);
      }
      changeTabs((tabs) => closeTab(tabs, tab.id));
    },
    [changeTabs],
  );

  const runCommand = useCallback(
    (command: PaletteCommand): void => {
      setPaletteOpen(false);
      switch (command.kind) {
        case "new-session": {
          setPage(HOME);
          sessions.leave();
          return;
        }
        case "open-session": {
          setPage(HOME);
          void sessions.open(command.sessionId);
          return;
        }
        case "open-settings": {
          openSettings(command.section);
          return;
        }
        case "toggle-side-panel": {
          setSidePanel(toggledSidePanel);
          return;
        }
        case "show-tab": {
          setSidePanel(shownSidePanel);
          changeTabs((tabs) => selectTab(tabs, command.tab));
          return;
        }
        case "open-tab": {
          openSideTab(command.tab);
          return;
        }
        default: {
          assertNever(command);
        }
      }
    },
    [openSettings, sessions, changeTabs, openSideTab],
  );

  const mention = useCallback((sessionId: string, path: string): void => {
    setDrafts((current) =>
      new Map(current).set(sessionId, appendMention(current.get(sessionId) ?? EMPTY_TEXT, path)),
    );
    setPromptFocusRequests((current) => current + 1);
  }, []);

  return (
    <div
      ref={panels.root}
      className="isolate flex h-screen w-screen overflow-hidden bg-page text-ink"
    >
      {page.kind === "settings" && setup.status === "ready" ? (
        <SettingsPage
          settings={settings}
          connection={setup.value.connection}
          providers={setup.value.providers}
          section={page.section}
          onSection={openSettings}
          onSettings={setSettings}
          onConnection={applyConnection}
          onProviders={applyProviders}
          onClose={closeSettings}
        />
      ) : (
        <>
          <Panel
            warning={
              setup.status === "ready" ? (
                <ConnectionWarning
                  state={setup.value.connection}
                  onOpen={() => {
                    openSettings(FIRST_SECTION);
                  }}
                />
              ) : null
            }
            action={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Settings"
                disabled={setup.status !== "ready"}
                onClick={() => {
                  openSettings(FIRST_SECTION);
                }}
              >
                <Settings aria-hidden />
              </Button>
            }
          >
            <Sidebar
              sessions={sessions.index.sessions}
              pulses={sessions.pulses}
              openId={snapshotId}
              onOpen={(sessionId) => {
                void sessions.open(sessionId);
              }}
              onNew={sessions.leave}
              onPin={(sessionId, pinned) => {
                void sessions.pin(sessionId, pinned);
              }}
              onArchive={(sessionId) => {
                void sessions.archive(sessionId);
              }}
            />
            {layoutFailure === null ? null : (
              <p role="alert" className="mt-3 text-meta text-red">
                The panel widths were not saved: {layoutFailure}
              </p>
            )}
          </Panel>
          <ResizeHandle label={SIDEBAR_HANDLE_LABEL} {...panels.handle("sidebar")} />
          <main hidden={expanded} className="flex min-w-0 flex-1 flex-col overflow-hidden bg-page">
            <TrailingCorner
              value={
                sidePanel === "closed" ? (
                  <SidePanelToggle
                    onToggle={() => {
                      setSidePanel("open");
                    }}
                  />
                ) : null
              }
            >
              <Centre
                setup={setup}
                settings={settings}
                sessions={sessions}
                newDraft={newDraft}
                drafts={drafts}
                promptFocusRequests={promptFocusRequests}
                onRetry={loadSetup}
                onSection={openSettings}
                onNewDraft={setNewDraft}
                onDraft={(sessionId, text) => {
                  setDrafts((current) => new Map(current).set(sessionId, text));
                }}
              />
            </TrailingCorner>
          </main>
          {sidePanel === "closed" ? null : (
            <>
              {expanded ? null : (
                <ResizeHandle label={SIDE_PANEL_HANDLE_LABEL} {...panels.handle("sidePanel")} />
              )}
              <TreeResize value={panels.handle("tree")}>
                <RightPanel
                  tabs={activeTabs}
                  snapshot={sessions.snapshot}
                  sessions={sessions.index.sessions}
                  connection={setup.status === "ready" ? setup.value.connection : null}
                  theme={settings.theme}
                  expanded={expanded}
                  onSelect={(value) => {
                    changeTabs((tabs) => selectTab(tabs, value));
                  }}
                  onOpen={openSideTab}
                  onClose={closeSideTab}
                  onExpand={() => {
                    setSidePanel(expanded ? "open" : "expanded");
                  }}
                  onCollapse={() => {
                    setSidePanel("closed");
                  }}
                  onOpenSettings={() => {
                    openSettings(FIRST_SECTION);
                  }}
                  onMention={mention}
                />
              </TreeResize>
            </>
          )}
        </>
      )}
      <CommandPalette
        open={paletteOpen}
        sessions={sessions.index.sessions}
        onRun={runCommand}
        onClose={() => {
          setPaletteOpen(false);
        }}
      />
      <UpdateToast />
    </div>
  );
}

interface CentreProps {
  readonly setup: RequestState<Setup>;
  readonly settings: SettingsView;
  readonly sessions: SessionsController;
  readonly newDraft: NewSessionDraft;
  readonly drafts: ReadonlyMap<string, string>;
  readonly promptFocusRequests: number;
  readonly onRetry: () => void;
  readonly onSection: (section: SettingsSection) => void;
  readonly onNewDraft: (draft: NewSessionDraft) => void;
  readonly onDraft: (sessionId: string, text: string) => void;
}

function Centre({
  setup,
  settings,
  sessions,
  newDraft,
  drafts,
  promptFocusRequests,
  onRetry,
  onSection,
  onNewDraft,
  onDraft,
}: CentreProps): ReactElement {
  switch (setup.status) {
    case "idle":
    case "running": {
      return (
        <Centred>
          <div className="rounded-card bg-surface px-6 py-5 shadow-card">
            <Spinner label="Checking your setup" />
          </div>
        </Centred>
      );
    }
    case "failed": {
      return (
        <Centred>
          <div className="w-96 rounded-card bg-surface p-6 shadow-card">
            <h1 className="text-title font-semibold text-ink">The app could not read its setup</h1>
            <p className="mt-1 text-body text-ink-2">{setup.message}</p>
            <Button className="mt-4" variant="outline" size="sm" onClick={onRetry}>
              Try again
            </Button>
          </div>
        </Centred>
      );
    }
    case "ready": {
      return (
        <Home
          input={{
            connection: setup.value.connection,
            repository: settings.repository,
            providers: setup.value.providers,
          }}
          defaults={settings.agents}
          sessions={sessions}
          newDraft={newDraft}
          drafts={drafts}
          promptFocusRequests={promptFocusRequests}
          onOpen={onSection}
          onNewDraft={onNewDraft}
          onDraft={onDraft}
        />
      );
    }
    default: {
      return assertNever(setup);
    }
  }
}

interface HomeProps {
  readonly input: OnboardingInput;
  readonly defaults: AgentDefaults;
  readonly sessions: SessionsController;
  readonly newDraft: NewSessionDraft;
  readonly drafts: ReadonlyMap<string, string>;
  readonly promptFocusRequests: number;
  readonly onOpen: (section: SettingsSection) => void;
  readonly onNewDraft: (draft: NewSessionDraft) => void;
  readonly onDraft: (sessionId: string, text: string) => void;
}

function Home({
  input,
  defaults,
  sessions,
  newDraft,
  drafts,
  promptFocusRequests,
  onOpen,
  onNewDraft,
  onDraft,
}: HomeProps): ReactElement {
  const snapshot = sessions.snapshot;
  if (snapshot !== null) {
    const sessionId = snapshot.session.id;
    return (
      <SessionView
        snapshot={snapshot}
        providers={input.providers}
        files={sessions.files}
        draft={drafts.get(sessionId) ?? EMPTY_TEXT}
        focusRequests={promptFocusRequests}
        working={sessions.working}
        onDraft={(text) => {
          onDraft(sessionId, text);
        }}
        onSend={(text) => {
          void sessions.sendTurn(text);
        }}
        onAnswer={(requestId, optionId) => {
          void sessions.answer(requestId, optionId);
        }}
        onInterrupt={() => {
          void sessions.interrupt();
        }}
        onRewind={sessions.rewind}
      />
    );
  }
  if (!canStartSession(input)) {
    return (
      <Centred>
        <OnboardingChecklist steps={onboardingSteps(input)} onOpen={onOpen} />
      </Centred>
    );
  }
  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <WindowStrip />
      <div className="mx-auto my-auto w-full max-w-2xl space-y-3 px-6 pb-4">
        <NewSessionComposer
          providers={input.providers}
          defaults={defaults}
          draft={newDraft}
          files={sessions.files}
          busy={sessions.working}
          onDraft={onNewDraft}
          onStart={(request, mode) => {
            void sessions.create(request);
            onNewDraft(mode === "send" ? EMPTY_DRAFT : { ...newDraft, text: "" });
          }}
        />
        {sessions.failure === null ? null : (
          <p role="alert" className="text-body text-red">
            {sessions.failure}
          </p>
        )}
      </div>
    </section>
  );
}

interface CentredProps {
  readonly children: ReactNode;
}

function Centred({ children }: CentredProps): ReactElement {
  return (
    <>
      <WindowStrip />
      <div className="m-auto">{children}</div>
    </>
  );
}

interface ConnectionWarningProps {
  readonly state: ConnectionState;
  readonly onOpen: () => void;
}

function ConnectionWarning({ state, onOpen }: ConnectionWarningProps): ReactElement | null {
  const warning = connectionWarning(state);
  if (warning === null) {
    return null;
  }
  return (
    <Button
      variant="link"
      size="xs"
      className="h-auto min-w-0 px-0 text-meta text-orange"
      onClick={onOpen}
    >
      <TriangleAlert aria-hidden />
      <span className="truncate">{warning}</span>
    </Button>
  );
}

interface PanelProps {
  readonly warning: ReactNode;
  readonly action: ReactNode;
  readonly children: ReactNode;
}

function Panel({ warning, action, children }: PanelProps): ReactElement {
  return (
    <aside className="panel-sidebar flex shrink-0 flex-col overflow-hidden border-r border-line bg-canvas">
      <WindowStrip edge="leading" className="justify-between gap-2 px-4">
        <h2 className="shrink-0 text-body font-semibold text-ink">{PRODUCT_NAME}</h2>
        <div className="flex min-w-0 items-center gap-1">
          {warning}
          {action}
        </div>
      </WindowStrip>
      <div className="flex min-h-0 flex-1 flex-col px-4 py-3 text-body text-ink-3">{children}</div>
    </aside>
  );
}
