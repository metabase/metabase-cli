import { MessageCircleQuestionMark, ShieldQuestionMark, type LucideIcon } from "lucide-react";
import { useState, type CSSProperties, type ReactElement } from "react";

import { assertNever } from "../../../contracts/assert-never";
import type { RequestKind, RequestOption, RequestResolution } from "../../../contracts/events";

import { GlideMenu } from "./GlideMenu";

const CARD_MS = 380;
const CARD_STYLE: CSSProperties = { animation: `fade-up ${CARD_MS}ms var(--ease-out-strong) both` };

const DISMISSED_SENTENCE = "Dismissed without an answer";
const EXPIRED_SENTENCE = "Expired before an answer";
const ANSWERED_SENTENCE = "Answered";
const CHOSE_PREFIX = "You chose:";
const TEXT_PLACEHOLDER = "Answer in your own words";

const OPTION_ROW =
  "relative z-10 flex items-baseline gap-2 rounded-control px-2 py-1.5 text-left transition-colors duration-100 disabled:opacity-50";

interface RequestKindFace {
  readonly heading: string;
  readonly Glyph: LucideIcon;
}

const REQUEST_KIND_FACES: Readonly<Record<RequestKind, RequestKindFace>> = {
  permission: { heading: "Permission", Glyph: ShieldQuestionMark },
  question: { heading: "Question", Glyph: MessageCircleQuestionMark },
};

export function resolutionSentence(
  resolution: RequestResolution,
  options: readonly RequestOption[],
): string {
  switch (resolution.kind) {
    case "answered": {
      const chosen = options.find((option) => option.id === resolution.optionId);
      return chosen === undefined ? ANSWERED_SENTENCE : `${CHOSE_PREFIX} ${chosen.label}`;
    }
    case "dismissed": {
      return DISMISSED_SENTENCE;
    }
    case "expired": {
      return EXPIRED_SENTENCE;
    }
    default: {
      return assertNever(resolution);
    }
  }
}

interface ApprovalHeadingProps {
  readonly kind: RequestKind;
  readonly prompt: string;
}

function ApprovalHeading({ kind, prompt }: ApprovalHeadingProps): ReactElement {
  const face = REQUEST_KIND_FACES[kind];
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-center gap-1.5 text-meta font-medium text-ink-3">
        <face.Glyph aria-hidden className="size-3.5 shrink-0" />
        {face.heading}
      </span>
      <p className="text-body font-medium text-ink">{prompt}</p>
    </div>
  );
}

interface ApprovalOutcomeProps {
  readonly resolution: RequestResolution;
  readonly options: readonly RequestOption[];
}

function ApprovalOutcome({ resolution, options }: ApprovalOutcomeProps): ReactElement {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-body text-ink-2">{resolutionSentence(resolution, options)}</p>
      {resolution.kind === "answered" && resolution.text !== null && (
        <p className="text-body text-ink-3">{resolution.text}</p>
      )}
    </div>
  );
}

interface ApprovalProps {
  readonly kind: RequestKind;
  readonly prompt: string;
  readonly options: readonly RequestOption[];
  readonly acceptsText: boolean;
  readonly resolution: RequestResolution | null;
  readonly busy: boolean;
  readonly onAnswer: (optionId: string, text: string | null) => void;
}

export function Approval({
  kind,
  prompt,
  options,
  acceptsText,
  resolution,
  busy,
  onAnswer,
}: ApprovalProps): ReactElement {
  const [text, setText] = useState<string | null>(null);
  const fieldValue = text === null ? "" : text;

  return (
    <div className="w-full overflow-hidden rounded-card bg-surface shadow-card" style={CARD_STYLE}>
      <div className="primitive-card-pad flex flex-col gap-2.5">
        <ApprovalHeading kind={kind} prompt={prompt} />
        {resolution === null ? (
          <GlideMenu>
            <div className="flex flex-col gap-0.5">
              {options.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  data-menu-row
                  disabled={busy}
                  onClick={() => onAnswer(option.id, text)}
                  className={OPTION_ROW}
                >
                  <span className="text-body text-ink">{option.label}</span>
                  {option.hint !== null && (
                    <span className="min-w-0 truncate text-detail text-ink-3">{option.hint}</span>
                  )}
                </button>
              ))}
            </div>
          </GlideMenu>
        ) : (
          <ApprovalOutcome resolution={resolution} options={options} />
        )}
      </div>

      {resolution === null && acceptsText && (
        <div className="primitive-card-footer border-t border-line">
          <input
            value={fieldValue}
            disabled={busy}
            placeholder={TEXT_PLACEHOLDER}
            aria-label={TEXT_PLACEHOLDER}
            onChange={(event) =>
              setText(event.target.value.length === 0 ? null : event.target.value)
            }
            className="w-full bg-transparent text-body text-ink outline-none placeholder:text-ink-3 disabled:opacity-50"
          />
        </div>
      )}
    </div>
  );
}
