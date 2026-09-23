import type { ReactElement, ReactNode } from "react";

import type { SettingsSection } from "@/settings-sections";
import { SETTINGS_SECTION_TITLES } from "@/settings-sections";

interface SettingsCardProps {
  readonly section: SettingsSection;
  readonly status: ReactNode;
  readonly children: ReactNode;
}

export function SettingsCard({ section, status, children }: SettingsCardProps): ReactElement {
  return (
    <section aria-label={SETTINGS_SECTION_TITLES[section]} className="flex flex-col gap-4">
      <header className="flex items-start justify-between gap-4">
        <h1 className="text-title font-semibold text-ink">{SETTINGS_SECTION_TITLES[section]}</h1>
        {status}
      </header>
      <div className="flex flex-col gap-3 rounded-card bg-surface p-4 shadow-card">{children}</div>
    </section>
  );
}
