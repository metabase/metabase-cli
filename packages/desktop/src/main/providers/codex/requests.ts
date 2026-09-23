import { z } from "zod";

import { assertNever } from "../../../contracts/assert-never";
import type { RequestOption } from "../../../contracts/events";

import { firstText } from "../text";

export const APPROVAL_METHOD = {
  command: "item/commandExecution/requestApproval",
  fileChange: "item/fileChange/requestApproval",
  permissions: "item/permissions/requestApproval",
} as const;

export const USER_INPUT_METHOD = "item/tool/requestUserInput";

export const ACCEPT_OPTION_ID = "accept";
export const ACCEPT_SESSION_OPTION_ID = "acceptForSession";
export const DECLINE_OPTION_ID = "decline";
export const CANCEL_OPTION_ID = "cancel";
export const OTHER_OPTION_ID = "other";

const SESSION_SCOPE = "session";
const EMPTY_GRANT = {};
const QUESTION_ID_SEPARATOR = ":";
const ALLOW_ACTION_PROMPT = "Allow this Codex action?";
const MORE_ACCESS_PROMPT = "Codex is asking for more access.";

export const ApprovalDecision = z.enum([
  ACCEPT_OPTION_ID,
  ACCEPT_SESSION_OPTION_ID,
  DECLINE_OPTION_ID,
  CANCEL_OPTION_ID,
]);
export type ApprovalDecision = z.infer<typeof ApprovalDecision>;

export type ApprovalKind = keyof typeof APPROVAL_METHOD;

const QuestionOption = z
  .object({ label: z.string().min(1), description: z.string().nullish() })
  .loose();

export const AskedQuestion = z
  .object({
    id: z.string().min(1),
    question: z.string().min(1),
    options: z.array(QuestionOption).nullish(),
  })
  .loose();
export type AskedQuestion = z.infer<typeof AskedQuestion>;

const CommandApprovalParams = z
  .object({
    itemId: z.string().min(1),
    command: z.string().nullish(),
    reason: z.string().nullish(),
  })
  .loose();

const FileChangeApprovalParams = z
  .object({
    itemId: z.string().min(1),
    grantRoot: z.string().nullish(),
    reason: z.string().nullish(),
  })
  .loose();

const PermissionsApprovalParams = z
  .object({ itemId: z.string().min(1), permissions: z.json(), reason: z.string().nullish() })
  .loose();

const UserInputParams = z
  .object({ itemId: z.string().min(1), questions: z.array(AskedQuestion) })
  .loose();

export interface ApprovalAsk {
  readonly requestId: string;
  readonly kind: ApprovalKind;
  readonly itemId: string;
  readonly detail: string | null;
}

export interface QuestionAsk {
  readonly requestId: string;
  readonly itemId: string;
  readonly question: AskedQuestion;
}

export interface ApprovalAnswer {
  readonly decision: ApprovalDecision;
}

export interface PermissionsAnswer {
  readonly permissions: unknown;
  readonly scope?: typeof SESSION_SCOPE;
}

interface QuestionAnswer {
  readonly answers: readonly string[];
}

export interface UserInputAnswer {
  readonly answers: Record<string, QuestionAnswer>;
}

export function approvalOptions(): RequestOption[] {
  return [
    { id: ACCEPT_OPTION_ID, label: "Allow", hint: null },
    {
      id: ACCEPT_SESSION_OPTION_ID,
      label: "Always allow",
      hint: "For the rest of this session",
    },
    { id: DECLINE_OPTION_ID, label: "Decline", hint: null },
    { id: CANCEL_OPTION_ID, label: "Cancel", hint: null },
  ];
}

export function questionOptions(question: AskedQuestion): RequestOption[] {
  const offered = question.options;
  if (offered === null || offered === undefined || offered.length === 0) {
    return [{ id: OTHER_OPTION_ID, label: "Answer", hint: null }];
  }
  return offered.map((option) => ({
    id: option.label,
    label: option.label,
    hint: firstText(option.description),
  }));
}

export function approvalPrompt(kind: ApprovalKind, label: string | null): string {
  switch (kind) {
    case "command":
    case "fileChange": {
      return label === null ? ALLOW_ACTION_PROMPT : `Allow ${label}?`;
    }
    case "permissions": {
      return label === null ? MORE_ACCESS_PROMPT : `${MORE_ACCESS_PROMPT} ${label}`;
    }
    default: {
      return assertNever(kind);
    }
  }
}

export function approvalAnswer(decision: ApprovalDecision): ApprovalAnswer {
  return { decision };
}

// The permission ask carries no decision: the grant itself is the answer, and an empty grant is the
// refusal.
export function permissionsAnswer(
  decision: ApprovalDecision,
  permissions: unknown,
): PermissionsAnswer {
  switch (decision) {
    case ACCEPT_OPTION_ID: {
      return { permissions };
    }
    case ACCEPT_SESSION_OPTION_ID: {
      return { permissions, scope: SESSION_SCOPE };
    }
    case DECLINE_OPTION_ID:
    case CANCEL_OPTION_ID: {
      return { permissions: EMPTY_GRANT };
    }
    default: {
      return assertNever(decision);
    }
  }
}

export function answerValue(optionId: string, text: string | null): string {
  return optionId === OTHER_OPTION_ID && text !== null ? text : optionId;
}

export function userInputAnswer(answers: ReadonlyMap<string, string>): UserInputAnswer {
  const byQuestion: Record<string, QuestionAnswer> = {};
  for (const [questionId, value] of answers) {
    byQuestion[questionId] = { answers: [value] };
  }
  return { answers: byQuestion };
}

export interface GrantValue {
  readonly permissions: unknown;
}

export interface ShapedApproval {
  readonly ask: ApprovalAsk;
  readonly grant: GrantValue | null;
}

export function shapeApproval(
  kind: ApprovalKind,
  requestId: string,
  params: unknown,
): ShapedApproval | null {
  switch (kind) {
    case "command": {
      const parsed = CommandApprovalParams.safeParse(params);
      if (!parsed.success) {
        return null;
      }
      const detail = firstText(parsed.data.command, parsed.data.reason);
      return { ask: { requestId, kind, itemId: parsed.data.itemId, detail }, grant: null };
    }
    case "fileChange": {
      const parsed = FileChangeApprovalParams.safeParse(params);
      if (!parsed.success) {
        return null;
      }
      const detail = firstText(parsed.data.grantRoot, parsed.data.reason);
      return { ask: { requestId, kind, itemId: parsed.data.itemId, detail }, grant: null };
    }
    case "permissions": {
      const parsed = PermissionsApprovalParams.safeParse(params);
      if (!parsed.success) {
        return null;
      }
      const detail = firstText(parsed.data.reason);
      return {
        ask: { requestId, kind, itemId: parsed.data.itemId, detail },
        grant: { permissions: parsed.data.permissions },
      };
    }
    default: {
      return assertNever(kind);
    }
  }
}

export function shapeQuestions(requestId: string, params: unknown): QuestionAsk[] | null {
  const parsed = UserInputParams.safeParse(params);
  if (!parsed.success || parsed.data.questions.length === 0) {
    return null;
  }
  return parsed.data.questions.map((question) => ({
    requestId: `${requestId}${QUESTION_ID_SEPARATOR}${question.id}`,
    itemId: parsed.data.itemId,
    question,
  }));
}
