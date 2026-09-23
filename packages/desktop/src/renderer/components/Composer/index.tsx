import { ArrowUp, ChevronDown, FolderGit2, GitBranch, Square, type LucideIcon } from "lucide-react";
import type { ReactElement } from "react";

import type { PendingRequest } from "../../../contracts/projector";
import type { ProviderHealth } from "../../../contracts/providers";
import type { CreateSessionRequest, Session } from "../../../contracts/session";
import type { AgentDefaults } from "../../../contracts/settings";
import type { Choice, ChoiceKey } from "@/composer/choices";
import {
  LABEL_SEPARATOR,
  choose,
  newSessionChoices,
  newSessionSetup,
  sessionFacts,
  startRequest,
} from "@/composer/choices";
import { cn } from "@/cn";
import type { NewSessionDraft } from "@/composer/draft";

import { Button } from "../ui/button";
import {
  Menu,
  MenuContent,
  MenuGroup,
  MenuGroupLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
} from "../ui/menu";

import { PromptBar, type SubmitMode } from "./PromptBar";

const NEW_PLACEHOLDER = "What should the agent do?";
const FOLLOW_PLACEHOLDER = "Reply, or steer the agent";
const ANSWER_PLACEHOLDER = "Answer the agent to carry on";
const SEND_LABEL = "Send";
const STOP_LABEL = "Stop";
const NO_AGENT_LABEL = "No agent is ready";
// Nothing outside a new session's field asks for its focus.
const NO_FOCUS_REQUESTS = 0;

interface ChoiceChipProps {
  readonly choice: Choice;
  readonly disabled: boolean;
  readonly onChoose: (key: ChoiceKey, value: string) => void;
}

// On a short row the workspace drops to its icon, then the agent and the model truncate; the
// permissions stay whole.
const CHIP_GIVE: Readonly<Record<ChoiceKey, string>> = {
  workspace: "shrink-0",
  provider: "shrink",
  model: "shrink",
  permission: "shrink-0",
};

function chipIcon(choice: Choice): LucideIcon | null {
  if (choice.key !== "workspace") {
    return null;
  }
  return choice.value === "in-place" ? FolderGit2 : GitBranch;
}

function ChoiceChip({ choice, disabled, onChoose }: ChoiceChipProps): ReactElement {
  const Icon = chipIcon(choice);
  return (
    <Menu>
      <MenuTrigger
        data-chip={choice.key}
        disabled={disabled}
        aria-label={`${choice.title}: ${choice.label}`}
        render={
          <Button
            variant="ghost"
            size="sm"
            className={cn("min-w-0 text-ink-2", CHIP_GIVE[choice.key])}
          />
        }
      >
        {Icon === null ? null : <Icon aria-hidden className="text-ink-3" />}
        <span className={cn("truncate", Icon !== null && "@max-sm:sr-only")}>{choice.label}</span>
        <ChevronDown aria-hidden className="text-ink-3 @max-sm:hidden" />
      </MenuTrigger>
      <MenuContent align="start">
        <MenuGroup>
          <MenuGroupLabel>{choice.title}</MenuGroupLabel>
          <MenuRadioGroup
            value={choice.value}
            onValueChange={(value: unknown) => {
              if (typeof value === "string") {
                onChoose(choice.key, value);
              }
            }}
          >
            {choice.options.map((option) => (
              <MenuRadioItem key={option.value} value={option.value} closeOnClick>
                {option.label}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuGroup>
      </MenuContent>
    </Menu>
  );
}

interface FactsProps {
  readonly facts: readonly string[];
}

function Facts({ facts }: FactsProps): ReactElement {
  return (
    <span className="min-w-0 truncate px-1 text-detail text-ink-3">
      {facts.join(LABEL_SEPARATOR)}
    </span>
  );
}

interface SendButtonProps {
  readonly disabled: boolean;
  readonly onSend: () => void;
}

function SendButton({ disabled, onSend }: SendButtonProps): ReactElement {
  return (
    <Button
      size="icon-sm"
      className="rounded-full"
      aria-label={SEND_LABEL}
      title={SEND_LABEL}
      disabled={disabled}
      onClick={onSend}
    >
      <ArrowUp aria-hidden />
    </Button>
  );
}

interface StopButtonProps {
  readonly onStop: () => void;
}

function StopButton({ onStop }: StopButtonProps): ReactElement {
  return (
    <Button
      size="icon-sm"
      className="rounded-full"
      aria-label={STOP_LABEL}
      title={STOP_LABEL}
      onClick={onStop}
    >
      <Square aria-hidden className="size-3 fill-current" />
    </Button>
  );
}

export interface NewSessionComposerProps {
  readonly providers: readonly ProviderHealth[];
  readonly defaults: AgentDefaults;
  readonly draft: NewSessionDraft;
  readonly files: readonly string[];
  readonly busy: boolean;
  readonly onDraft: (draft: NewSessionDraft) => void;
  readonly onStart: (request: CreateSessionRequest, mode: SubmitMode) => void;
}

export function NewSessionComposer({
  providers,
  defaults,
  draft,
  files,
  busy,
  onDraft,
  onStart,
}: NewSessionComposerProps): ReactElement {
  const ready = providers.filter((health) => health.status === "ready");
  const setup = newSessionSetup(ready, defaults, draft);
  const request = setup === null ? null : startRequest(setup, draft.text);

  const start = (mode: SubmitMode): void => {
    if (request !== null && !busy) {
      onStart(request, mode);
    }
  };

  return (
    <PromptBar
      value={draft.text}
      focusRequests={NO_FOCUS_REQUESTS}
      placeholder={NEW_PLACEHOLDER}
      files={files}
      commands={[]}
      disabled={setup === null}
      onChange={(text) => {
        onDraft({ ...draft, text });
      }}
      onSubmit={start}
      controls={
        setup === null ? (
          <Facts facts={[NO_AGENT_LABEL]} />
        ) : (
          newSessionChoices(ready, setup).map((choice) => (
            <ChoiceChip
              key={choice.key}
              choice={choice}
              disabled={busy}
              onChoose={(key, value) => {
                onDraft(choose(setup, ready, draft, key, value));
              }}
            />
          ))
        )
      }
      action={
        <SendButton
          disabled={request === null || busy}
          onSend={() => {
            start("send");
          }}
        />
      }
    />
  );
}

export interface SessionComposerProps {
  readonly session: Session;
  readonly providers: readonly ProviderHealth[];
  readonly pending: readonly PendingRequest[];
  readonly running: boolean;
  readonly busy: boolean;
  readonly files: readonly string[];
  readonly draft: string;
  readonly focusRequests: number;
  readonly onDraft: (text: string) => void;
  readonly onSend: (text: string) => void;
  readonly onInterrupt: () => void;
  readonly onAnswer: (requestId: string, optionId: string) => void;
}

export function SessionComposer({
  session,
  providers,
  pending,
  running,
  busy,
  files,
  draft,
  focusRequests,
  onDraft,
  onSend,
  onInterrupt,
  onAnswer,
}: SessionComposerProps): ReactElement {
  const waiting = pending[0];
  const ready = draft.trim().length > 0;
  // The app has no command to change these once a session is running.
  const facts = sessionFacts(session, providers);

  const send = (): void => {
    if (ready && !running && !busy && waiting === undefined) {
      onSend(draft.trim());
    }
  };

  return (
    <PromptBar
      value={draft}
      focusRequests={focusRequests}
      placeholder={waiting === undefined ? FOLLOW_PLACEHOLDER : ANSWER_PLACEHOLDER}
      files={files}
      commands={session.slashCommands}
      disabled={false}
      onChange={onDraft}
      onSubmit={send}
      controls={
        waiting === undefined ? (
          <Facts facts={facts} />
        ) : (
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            {waiting.options.map((option) => (
              <Button
                key={option.id}
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  onAnswer(waiting.requestId, option.id);
                }}
              >
                {option.label}
              </Button>
            ))}
          </div>
        )
      }
      action={
        running ? (
          <StopButton onStop={onInterrupt} />
        ) : (
          <SendButton disabled={!ready || busy || waiting !== undefined} onSend={send} />
        )
      }
    />
  );
}
