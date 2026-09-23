import type { ChangeEvent, ReactElement } from "react";
import { useState } from "react";

import type { RepositoryLayout, RepositorySnapshot, SettingsView } from "../../contracts/settings";
import { assertNever } from "../../contracts/assert-never";
import { rde } from "@/bridge";
import { requestFailure, useRequest } from "@/request";

import { OptionalDetail } from "./Detail";
import type { NoteTone } from "./Note";
import { Note } from "./Note";
import type { SaveOutcome } from "./SaveStatus";
import { SaveStatus } from "./SaveStatus";
import { SettingsCard } from "./SettingsCard";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

interface LayoutNote {
  readonly tone: NoteTone;
  readonly text: string;
}

const LAYOUT_NOTES: Readonly<Record<RepositoryLayout, LayoutNote | null>> = {
  representation: null,
  empty: {
    tone: "info",
    text: "This repository is empty. The first sync fills it.",
  },
  other: {
    tone: "warning",
    text: "This repository doesn't hold Metabase content. Check it's the one you meant.",
  },
};

interface RepositoryCardProps {
  readonly settings: SettingsView;
  readonly onSettings: (settings: SettingsView) => void;
}

export function RepositoryCard({ settings, onSettings }: RepositoryCardProps): ReactElement {
  const update = useRequest<SaveOutcome>();
  const busy = update.state.status === "running";
  const failure = requestFailure(update.state);
  const repository = settings.repository;

  const chooseFolder = (): void => {
    void update.send(async () => {
      const choice = await rde.repositoryChoose();
      switch (choice.kind) {
        case "chosen": {
          onSettings(choice.settings);
          return "saved";
        }
        case "cancelled": {
          return "unchanged";
        }
        case "rejected": {
          throw new Error(choice.message);
        }
        default: {
          return assertNever(choice);
        }
      }
    });
  };

  const clearFolder = (): void => {
    void update.send(async () => {
      onSettings(await rde.repositoryClear());
      return "saved";
    });
  };

  return (
    <SettingsCard
      section="repository"
      status={<SaveStatus state={update.state} pendingLabel="Saving" />}
    >
      {repository === null ? null : <RepositoryDetails repository={repository} />}
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={busy} onClick={chooseFolder}>
          {repository === null ? "Choose folder" : "Change folder"}
        </Button>
        {repository === null ? null : (
          <Button variant="ghost" size="sm" disabled={busy} onClick={clearFolder}>
            Clear
          </Button>
        )}
      </div>
      <TextSetting
        id="worktree-root"
        label="Worktree root"
        hint="Derived from the repository"
        value={settings.worktreeRoot}
        saveLabel="Save worktree root"
        busy={busy}
        onSave={async (path) => {
          const next = await rde.settingsSetWorktreeRoot({ path });
          onSettings(next);
          return next.worktreeRoot;
        }}
      />
      <TextSetting
        id="editor"
        label="Editor"
        hint="System default"
        value={settings.editor ?? ""}
        saveLabel="Save editor"
        busy={busy}
        onSave={async (command) => {
          const next = await rde.settingsSetEditor({ command });
          onSettings(next);
          return next.editor ?? "";
        }}
      />
      {failure === null ? null : <Note tone="error">{failure}</Note>}
    </SettingsCard>
  );
}

interface TextSettingProps {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly value: string;
  readonly saveLabel: string;
  readonly busy: boolean;
  readonly onSave: (value: string) => Promise<string>;
}

// Saving hands back what main stored, which is the default main derived when the field was left empty.
function TextSetting({
  id,
  label,
  hint,
  value,
  saveLabel,
  busy,
  onSave,
}: TextSettingProps): ReactElement {
  const [text, setText] = useState(value);
  const save = useRequest<SaveOutcome>();
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={text}
        placeholder={hint}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          setText(event.target.value);
        }}
      />
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={busy || save.state.status === "running"}
          onClick={() => {
            void save.send(async () => {
              setText(await onSave(text));
              return "saved";
            });
          }}
        >
          {saveLabel}
        </Button>
        <SaveStatus state={save.state} pendingLabel="Saving" />
      </div>
    </div>
  );
}

interface RepositoryDetailsProps {
  readonly repository: RepositorySnapshot;
}

function RepositoryDetails({ repository }: RepositoryDetailsProps): ReactElement {
  const note = LAYOUT_NOTES[repository.layout];
  return (
    <div className="flex flex-col gap-2">
      <p className="text-body break-all text-ink">{repository.path}</p>
      <OptionalDetail label="Remote" value={repository.remote} absent="No remote" mono={false} />
      <OptionalDetail
        label="Default branch"
        value={repository.defaultBranch}
        absent="No default branch"
        mono
      />
      {note === null ? null : <Note tone={note.tone}>{note.text}</Note>}
    </div>
  );
}
