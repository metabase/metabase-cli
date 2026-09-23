import { ArrowLeft } from "lucide-react";
import type { ReactElement } from "react";

import type { ConnectionState } from "../../contracts/connection";
import type { ProviderHealthList } from "../../contracts/providers";
import type { SettingsView } from "../../contracts/settings";
import { assertNever } from "../../contracts/assert-never";
import { cn } from "@/cn";
import type { SettingsSection } from "@/settings-sections";
import { SETTINGS_SECTIONS, SETTINGS_SECTION_TITLES } from "@/settings-sections";

import { AgentsCard } from "./AgentsCard";
import { AppearanceCard } from "./AppearanceCard";
import { ConnectionCard } from "./ConnectionCard";
import { RepositoryCard } from "./RepositoryCard";
import { Button } from "./ui/button";
import { PlainButton } from "./ui/plain-button";
import { WindowStrip } from "./ui/window-strip";

const BACK_LABEL = "Back to app";

interface SectionProps {
  readonly settings: SettingsView;
  readonly connection: ConnectionState;
  readonly providers: ProviderHealthList;
  readonly section: SettingsSection;
  readonly onSettings: (settings: SettingsView) => void;
  readonly onConnection: (connection: ConnectionState) => void;
  readonly onProviders: (providers: ProviderHealthList) => void;
}

interface SettingsPageProps extends SectionProps {
  readonly onSection: (section: SettingsSection) => void;
  readonly onClose: () => void;
}

export function SettingsPage({ onSection, onClose, ...shown }: SettingsPageProps): ReactElement {
  return (
    <>
      <aside
        aria-label="Settings"
        className="panel-sidebar flex shrink-0 flex-col overflow-hidden border-r border-line bg-canvas"
      >
        <WindowStrip edge="leading">
          <Button variant="ghost" size="sm" className="-ml-2.5" onClick={onClose}>
            <ArrowLeft aria-hidden />
            {BACK_LABEL}
          </Button>
        </WindowStrip>
        <nav aria-label="Settings sections" className="px-2 py-3">
          <ul className="flex flex-col gap-0.5">
            {SETTINGS_SECTIONS.map((id) => (
              <li key={id}>
                <PlainButton
                  aria-current={id === shown.section}
                  className={cn(
                    "w-full rounded-control px-2 py-1.5 text-left text-body text-ink transition-colors duration-100",
                    id === shown.section ? "bg-inset" : "hover:bg-hover",
                  )}
                  onClick={() => {
                    onSection(id);
                  }}
                >
                  {SETTINGS_SECTION_TITLES[id]}
                </PlainButton>
              </li>
            ))}
          </ul>
        </nav>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-page">
        <WindowStrip edge="trailing" />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-2xl px-6 pt-8 pb-6">
            <Section {...shown} />
          </div>
        </div>
      </main>
    </>
  );
}

function Section({
  settings,
  connection,
  providers,
  section,
  onSettings,
  onConnection,
  onProviders,
}: SectionProps): ReactElement {
  switch (section) {
    case "metabase": {
      return <ConnectionCard connection={connection} onConnection={onConnection} />;
    }
    case "repository": {
      return <RepositoryCard settings={settings} onSettings={onSettings} />;
    }
    case "agents": {
      return (
        <AgentsCard
          settings={settings}
          providers={providers}
          onSettings={onSettings}
          onProviders={onProviders}
        />
      );
    }
    case "appearance": {
      return <AppearanceCard settings={settings} onSettings={onSettings} />;
    }
    default: {
      return assertNever(section);
    }
  }
}
