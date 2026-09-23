import { z } from "zod";

export const QUESTION_TOOL_NAME = "AskUserQuestion";

const MULTI_SELECT_SEPARATOR = ", ";

const QuestionOption = z
  .object({
    label: z.string().min(1),
    description: z.string(),
  })
  .loose();

const AskedQuestion = z
  .object({
    question: z.string().min(1),
    header: z.string().min(1),
    multiSelect: z.boolean(),
    options: z.tuple([QuestionOption], QuestionOption),
  })
  .loose();
export type AskedQuestion = z.infer<typeof AskedQuestion>;

export const QuestionToolInput = z
  .object({
    questions: z.tuple([AskedQuestion], AskedQuestion),
  })
  .loose();
export type QuestionToolInput = z.infer<typeof QuestionToolInput>;

export type QuestionAnswers = Record<string, string>;

export type ChooseLabels = (question: AskedQuestion) => readonly string[];

// Claude Code reads the chosen labels back off the tool's own input, keyed by the question text;
// an input without them reports that the user declined to answer.
export function answeredQuestions(input: QuestionToolInput, choose: ChooseLabels): QuestionAnswers {
  const answers: QuestionAnswers = {};
  for (const question of input.questions) {
    answers[question.question] = choose(question).join(MULTI_SELECT_SEPARATOR);
  }
  return answers;
}
