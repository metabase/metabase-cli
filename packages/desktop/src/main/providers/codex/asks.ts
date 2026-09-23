import { assertNever } from "../../../contracts/assert-never";

import type { JsonRpcId } from "./protocol";
import {
  ApprovalDecision,
  CANCEL_OPTION_ID,
  answerValue,
  approvalAnswer,
  permissionsAnswer,
  userInputAnswer,
  type GrantValue,
  type QuestionAsk,
} from "./requests";

interface DecisionPending {
  readonly kind: "decision";
  readonly frameId: JsonRpcId;
}

interface GrantPending {
  readonly kind: "grant";
  readonly frameId: JsonRpcId;
  readonly permissions: unknown;
}

interface QuestionGroup {
  readonly frameId: JsonRpcId;
  readonly answers: Map<string, string>;
  readonly total: number;
  settled: boolean;
}

interface QuestionPending {
  readonly kind: "question";
  readonly questionId: string;
  readonly group: QuestionGroup;
}

type PendingAsk = DecisionPending | GrantPending | QuestionPending;

export interface AskResponder {
  respond(id: JsonRpcId, result: unknown): void;
}

export class PendingAsks {
  private readonly open = new Map<string, PendingAsk>();

  constructor(private readonly responder: AskResponder) {}

  openApproval(requestId: string, frameId: JsonRpcId, grant: GrantValue | null): void {
    this.open.set(
      requestId,
      grant === null
        ? { kind: "decision", frameId }
        : { kind: "grant", frameId, permissions: grant.permissions },
    );
  }

  openQuestions(asks: readonly QuestionAsk[], frameId: JsonRpcId): void {
    const group: QuestionGroup = {
      frameId,
      answers: new Map<string, string>(),
      total: asks.length,
      settled: false,
    };
    for (const ask of asks) {
      this.open.set(ask.requestId, { kind: "question", questionId: ask.question.id, group });
    }
  }

  answer(requestId: string, optionId: string, text: string | null): boolean {
    const ask = this.open.get(requestId);
    if (ask === undefined) {
      return false;
    }
    this.open.delete(requestId);
    this.send(ask, optionId, text);
    return true;
  }

  cancelAll(): string[] {
    const closed = [...this.open.keys()];
    for (const ask of this.open.values()) {
      this.send(ask, CANCEL_OPTION_ID, null);
    }
    this.open.clear();
    return closed;
  }

  private send(ask: PendingAsk, optionId: string, text: string | null): void {
    const chosen = ApprovalDecision.safeParse(optionId);
    const decision = chosen.success ? chosen.data : CANCEL_OPTION_ID;
    switch (ask.kind) {
      case "decision": {
        this.responder.respond(ask.frameId, approvalAnswer(decision));
        return;
      }
      case "grant": {
        this.responder.respond(ask.frameId, permissionsAnswer(decision, ask.permissions));
        return;
      }
      case "question": {
        this.sendAnswers(ask, optionId, text);
        return;
      }
      default: {
        return assertNever(ask);
      }
    }
  }

  private sendAnswers(ask: QuestionPending, optionId: string, text: string | null): void {
    const group = ask.group;
    if (group.settled) {
      return;
    }
    if (optionId === CANCEL_OPTION_ID) {
      group.settled = true;
      this.responder.respond(group.frameId, userInputAnswer(new Map<string, string>()));
      return;
    }
    group.answers.set(ask.questionId, answerValue(optionId, text));
    if (group.answers.size === group.total) {
      group.settled = true;
      this.responder.respond(group.frameId, userInputAnswer(group.answers));
    }
  }
}
