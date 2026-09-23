import type { RequestOption } from "../../../contracts/events";

import type { AskedQuestion } from "./questions";

export const ALLOW_OPTION_ID = "allow";
export const ALLOW_ALWAYS_OPTION_ID = "allow-always";
export const DENY_OPTION_ID = "deny";

export interface PermissionRequest {
  readonly requestId: string;
  readonly toolName: string;
  readonly input: unknown;
  readonly toolUseId: string;
  readonly title: string | null;
  readonly hasSuggestions: boolean;
}

interface OpenedPermission {
  readonly kind: "permission";
  readonly requestId: string;
}

interface OpenedQuestion {
  readonly kind: "question";
  readonly requestId: string;
  readonly question: AskedQuestion;
}

export type OpenedRequest = OpenedPermission | OpenedQuestion;

export interface OpenQuestion {
  readonly requestId: string;
  readonly questionText: string;
}

export function permissionOptions(hasSuggestions: boolean): RequestOption[] {
  const allow: RequestOption = { id: ALLOW_OPTION_ID, label: "Allow", hint: null };
  const deny: RequestOption = { id: DENY_OPTION_ID, label: "Deny", hint: null };
  if (!hasSuggestions) {
    return [allow, deny];
  }
  const always: RequestOption = {
    id: ALLOW_ALWAYS_OPTION_ID,
    label: "Always allow",
    hint: "For the rest of this session",
  };
  return [allow, always, deny];
}

export function questionOptions(question: AskedQuestion): RequestOption[] {
  return question.options.map((option) => ({
    id: option.label,
    label: option.label,
    hint: option.description.length > 0 ? option.description : null,
  }));
}
