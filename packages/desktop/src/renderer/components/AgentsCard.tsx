import type { VariantProps } from "class-variance-authority";
import type { ReactElement } from "react";

import type {
  ProviderAccount,
  ProviderHealth,
  ProviderHealthList,
  ProviderStatus,
} from "../../contracts/providers";
import { PROVIDER_LABELS } from "../../contracts/providers";
import type { AgentDefaults, SettingsView } from "../../contracts/settings";
import { rde } from "@/bridge";
import { PERMISSION_OPTIONS, startingModel } from "@/composer/choices";
import { PERMISSION_MODES } from "@/composer/draft";
import { inlineCodeSegments } from "@/inline-code";
import { requestFailure, useRequest } from "@/request";

import { Detail, DetailRow } from "./Detail";
import type { NoteTone } from "./Note";
import { Note } from "./Note";
import type { SaveOutcome } from "./SaveStatus";
import { SaveStatus } from "./SaveStatus";
import { SettingsCard } from "./SettingsCard";
import { Badge, badgeVariants } from "./ui/badge";
import { Button } from "./ui/button";
import { Select } from "./ui/select";
import { Spinner } from "./ui/spinner";

type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>;

interface StatusBadge {
  readonly label: string;
  readonly variant: BadgeVariant;
}

const STATUS_BADGES: Readonly<Record<ProviderStatus, StatusBadge>> = {
  ready: { label: "Ready", variant: "secondary" },
  unauthenticated: { label: "Not signed in", variant: "outline" },
  error: { label: "Error", variant: "destructive" },
  missing: { label: "Not installed", variant: "outline" },
};

const MESSAGE_TONES: Readonly<Record<ProviderStatus, NoteTone>> = {
  ready: "info",
  unauthenticated: "warning",
  error: "error",
  missing: "warning",
};

interface AgentsCardProps {
  readonly settings: SettingsView;
  readonly providers: ProviderHealthList;
  readonly onSettings: (settings: SettingsView) => void;
  readonly onProviders: (providers: ProviderHealthList) => void;
}

export function AgentsCard({
  settings,
  providers,
  onSettings,
  onProviders,
}: AgentsCardProps): ReactElement {
  const rescan = useRequest<ProviderHealthList>();
  const save = useRequest<SaveOutcome>();
  const scanning = rescan.state.status === "running";
  const saving = save.state.status === "running";
  const failure = requestFailure(rescan.state) ?? requestFailure(save.state);
  const defaults = settings.agents;

  const saveDefaults = (agents: AgentDefaults): void => {
    void save.send(async () => {
      onSettings(await rde.settingsSetAgents(agents));
      return "saved";
    });
  };

  const choosePermission = (value: string): void => {
    const permissionMode = PERMISSION_MODES.find((mode) => mode === value);
    if (permissionMode !== undefined) {
      saveDefaults({ ...defaults, permissionMode });
    }
  };

  const startRescan = (): void => {
    void rescan.send(async () => {
      const found = await rde.providersRescan();
      onProviders(found);
      return found;
    });
  };

  return (
    <SettingsCard section="agents" status={<SaveStatus state={save.state} pendingLabel="Saving" />}>
      {providers.length === 0 ? (
        <p className="text-body text-ink-2">No agents found.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {providers.map((provider) => (
            <AgentRow
              key={provider.kind}
              provider={provider}
              defaults={defaults}
              saving={saving}
              onModel={(model) => {
                saveDefaults({
                  ...defaults,
                  models: { ...defaults.models, [provider.kind]: model },
                });
              }}
            />
          ))}
        </ul>
      )}
      <div className="px-3">
        <DetailRow label="Permissions">
          <Select
            aria-label="Permissions for a new session"
            className="w-auto"
            value={defaults.permissionMode}
            disabled={saving}
            onChange={(event) => {
              choosePermission(event.target.value);
            }}
          >
            {PERMISSION_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </DetailRow>
      </div>
      {failure === null ? null : <Note tone="error">{failure}</Note>}
      <div>
        <Button variant="outline" size="sm" disabled={scanning} onClick={startRescan}>
          {scanning ? <Spinner label="Scanning" /> : "Rescan"}
        </Button>
      </div>
    </SettingsCard>
  );
}

interface AgentRowProps {
  readonly provider: ProviderHealth;
  readonly defaults: AgentDefaults;
  readonly saving: boolean;
  readonly onModel: (model: string) => void;
}

function AgentRow({ provider, defaults, saving, onModel }: AgentRowProps): ReactElement {
  const badge = STATUS_BADGES[provider.status];
  const model = provider.status === "ready" ? startingModel(provider, defaults) : null;
  const account = accountLabel(provider.account);
  return (
    <li className="flex flex-col gap-1.5 rounded-control bg-inset px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-body font-medium text-ink">{PROVIDER_LABELS[provider.kind]}</span>
        <Badge variant={badge.variant}>{badge.label}</Badge>
      </div>
      {account === null ? null : <Detail label="Account" value={account} mono={false} />}
      {model === null ? null : (
        <DetailRow label="Model">
          <Select
            aria-label={`Model for a new ${PROVIDER_LABELS[provider.kind]} session`}
            className="w-auto"
            value={model.id}
            disabled={saving}
            onChange={(event) => {
              onModel(event.target.value);
            }}
          >
            {provider.models.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </Select>
        </DetailRow>
      )}
      {provider.message === null ? null : (
        <Note tone={MESSAGE_TONES[provider.status]}>
          {inlineCodeSegments(provider.message).map((segment, index) =>
            segment.code ? (
              <code key={index} className="font-mono">
                {segment.text}
              </code>
            ) : (
              <span key={index}>{segment.text}</span>
            ),
          )}
        </Note>
      )}
    </li>
  );
}

function accountLabel(account: ProviderAccount | null): string | null {
  if (account === null) {
    return null;
  }
  return account.email ?? account.label;
}
